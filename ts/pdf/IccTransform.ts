/*******************************************************************************
 * Copyright (c) 2026 Maxprograms. All rights reserved.
 *
 * Licensed under the Business Source License 1.1 (the "License");
 * you may not use this file except in compliance with the License.
 *
 * Change Date: 2030-11-01
 * Change License: Mozilla Public License, v. 2.0
 *
 * Additional Use Grant:
 * You may make production use of the Licensed Work for personal use,
 * educational use, and academic research. "Personal use" means use by an
 * individual for their own purposes, and not on behalf of an employer, client
 * or other organization. You may also make production use of the Licensed Work
 * for trial purposes for a period of up to 30 days.
 *
 * You may obtain a copy of the License at https://spdx.org/licenses/BUSL-1.1.html
 * or in the LICENSE file provided in the root of this repository.
 *******************************************************************************/

const HEADER_LENGTH: number = 128;
const LAB: string = "Lab ";
const XYZ_SCALE: number = 65535 / 32768;
const LEGACY_LAB_SCALE: number = 65535 / 65280;
const PARAMETER_COUNTS: ReadonlyArray<number> = [1, 3, 4, 5, 7];
const INTENT_TAGS: ReadonlyMap<string, string> = new Map<string, string>([
    ["perceptual", "0"], ["relative-colorimetric", "1"], ["absolute-colorimetric", "1"], ["saturation", "2"]
]);
const MATRIX_COLUMNS: ReadonlyArray<string> = ["rXYZ", "gXYZ", "bXYZ"];
const MATRIX_CURVES: ReadonlyArray<string> = ["rTRC", "gTRC", "bTRC"];
const GRAY_CURVE: string = "kTRC";
const MEDIA_WHITE: string = "wtpt";
const COLORANT_TABLE: string = "clrt";
const COLORANT_NAME: number = 32;
const COLORANT_ENTRY: number = 38;

export class IccTransform {

    readonly connection: "lab" | "xyz-d50";

    private readonly view: DataView;
    private readonly tags: Map<string, number> = new Map<string, number>();
    private readonly intent: string;

    constructor(data: Uint8Array, intent: string) {
        // ICC.1:2022 §7.2.7: the PCS is PCSXYZ or PCSLAB, named at byte 20. §7.3: the tag table follows the header, a count
        // and then a signature, an offset and a size for each tag.
        this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        this.intent = intent;
        this.connection = this.signature(20) === LAB ? "lab" : "xyz-d50";
        const count: number = this.view.getUint32(HEADER_LENGTH);
        for (let index: number = 0; index < count; index++) {
            const entry: number = HEADER_LENGTH + 4 + index * 12;
            this.tags.set(this.signature(entry), this.view.getUint32(entry + 4));
        }
    }

    illuminant(): [number, number, number] {
        // ICC.1:2022 §7.2.16: the nCIEXYZ values of the illuminant of the PCS, at byte 68.
        return [this.fixed(68), this.fixed(72), this.fixed(76)];
    }

    mediaWhite(): [number, number, number] | undefined {
        const tag: number | undefined = this.tags.get(MEDIA_WHITE);
        return tag === undefined ? undefined : [this.fixed(tag + 8), this.fixed(tag + 12), this.fixed(tag + 16)];
    }

    colorants(): ReadonlyArray<string> | undefined {
        // ICC.1:2022 §10.5: a count at byte 8, then a name of 32 bytes and PCS values of 6 for each colorant, in the order of
        // the device channels.
        const tag: number | undefined = this.tags.get(COLORANT_TABLE);
        if (tag === undefined) {
            return undefined;
        }
        try {
            const names: Array<string> = [];
            for (let index: number = 0; index < this.view.getUint32(tag + 8); index++) {
                let name: string = "";
                for (let at: number = 0; at < COLORANT_NAME; at++) {
                    const byte: number = this.view.getUint8(tag + 12 + index * COLORANT_ENTRY + at);
                    if (byte === 0) {
                        break;
                    }
                    name += String.fromCharCode(byte);
                }
                names.push(name);
            }
            return names;
        } catch {
            return undefined;
        }
    }

    grid(): ReadonlyArray<number> | undefined {
        // The grid points of each input channel in the AToB table: §10.10 and §10.11 give one number for all of them, and
        // §10.12.3 one for each, in the CLUT that the offset at byte 24 names.
        const tag: number | undefined = this.transformTag("A2B");
        if (tag === undefined) {
            return undefined;
        }
        try {
            const inputs: number = this.view.getUint8(tag + 8);
            if (this.signature(tag) === "mAB ") {
                const clut: number = this.view.getUint32(tag + 24);
                return clut === 0 ? undefined : Array.from({ length: inputs }, (value: unknown, channel: number) => this.view.getUint8(tag + clut + channel));
            }
            return new Array<number>(inputs).fill(this.view.getUint8(tag + 10));
        } catch {
            return undefined;
        }
    }

    toConnection(device: ReadonlyArray<number>): Array<number> | undefined {
        // ICC.1:2022 §8.10.2: the AToB tag of the rendering intent, else AToB0, else the tone curves with the colorant
        // matrix or the gray curve. A profile whose data does not hold what its tags announce gives no color.
        try {
            const tag: number | undefined = this.transformTag("A2B");
            if (tag !== undefined) {
                return this.decoded(this.lookup(tag, device.map((value: number) => this.clip(value)), true), this.signature(tag));
            }
            if (MATRIX_COLUMNS.every((name: string) => this.tags.has(name)) && MATRIX_CURVES.every((name: string) => this.tags.has(name)) && device.length === 3) {
                // Annex F.3: the curves make the values linear, and the matrix of the three colorants gives PCSXYZ.
                const linear: Array<number> = MATRIX_CURVES.map((name: string, index: number) => this.curve(this.tags.get(name) as number, this.clip(device[index])));
                return [0, 1, 2].map((row: number) => MATRIX_COLUMNS.reduce((sum: number, name: string, column: number) =>
                    sum + this.fixed((this.tags.get(name) as number) + 8 + row * 4) * linear[column], 0));
            }
            const gray: number | undefined = this.tags.get(GRAY_CURVE);
            if (gray !== undefined && device.length === 1) {
                // Annex F.2: the curve gives the achromatic channel, which multiplies the PCS white point.
                const level: number = this.curve(gray, this.clip(device[0]));
                return this.connection === "lab" ? [100 * level, 0, 0] : this.illuminant().map((value: number) => value * level);
            }
            return undefined;
        } catch {
            return undefined;
        }
    }

    fromConnection(values: ReadonlyArray<number>): Array<number> | undefined {
        // ICC.1:2022 §8.10.2, in the other direction: the BToA tag of the rendering intent, else BToA0, else the inverse
        // of the matrix and curves model.
        try {
            const tag: number | undefined = this.transformTag("B2A");
            if (tag !== undefined) {
                return this.lookup(tag, this.encoded(values, this.signature(tag)), false);
            }
            if (MATRIX_COLUMNS.every((name: string) => this.tags.has(name)) && MATRIX_CURVES.every((name: string) => this.tags.has(name))) {
                // Annex F.3, equations F.7 to F.16: the inverse matrix, the result held in 0 to 1, and the inverse curves.
                const matrix: Array<Array<number>> = [0, 1, 2].map((row: number) => MATRIX_COLUMNS.map((name: string) => this.fixed((this.tags.get(name) as number) + 8 + row * 4)));
                const inverse: Array<Array<number>> | undefined = this.inverted(matrix);
                if (inverse === undefined) {
                    return undefined;
                }
                return MATRIX_CURVES.map((name: string, index: number) => {
                    const linear: number = inverse[index][0] * values[0] + inverse[index][1] * values[1] + inverse[index][2] * values[2];
                    return this.inverseCurve(this.tags.get(name) as number, this.clip(linear));
                });
            }
            const gray: number | undefined = this.tags.get(GRAY_CURVE);
            if (gray !== undefined) {
                // Annex F.2: the gray curve "is usually derived from the luminance channel of the PCS".
                return [this.inverseCurve(gray, this.clip(this.connection === "lab" ? values[0] / 100 : values[1]))];
            }
            return undefined;
        } catch {
            return undefined;
        }
    }

    private transformTag(prefix: string): number | undefined {
        return this.tags.get(prefix + (INTENT_TAGS.get(this.intent) ?? "1")) ?? this.tags.get(prefix + "0");
    }

    private decoded(values: ReadonlyArray<number>, type: string): Array<number> {
        // ICC.1:2022 §6.3.4.2: PCSXYZ in 16 bits is a u1Fixed15Number, and PCSLAB has L* from 0 to 100 and a* and b* from
        // -128 to 127; §10.10: lut16Type keeps the legacy PCSLAB encoding, where FF00h stands for 100 and for 127.
        if (this.connection === "xyz-d50") {
            return values.map((value: number) => value * XYZ_SCALE);
        }
        const scale: number = type === "mft2" ? LEGACY_LAB_SCALE : 1;
        return [values[0] * scale * 100, values[1] * scale * 255 - 128, values[2] * scale * 255 - 128];
    }

    private encoded(values: ReadonlyArray<number>, type: string): Array<number> {
        // ICC.1:2022 §6.4: what is outside of the encoding range is "clipped on a per-component basis".
        if (this.connection === "xyz-d50") {
            return values.map((value: number) => this.clip(value / XYZ_SCALE));
        }
        const scale: number = type === "mft2" ? LEGACY_LAB_SCALE : 1;
        return [this.clip(values[0] / 100 / scale), this.clip((values[1] + 128) / 255 / scale), this.clip((values[2] + 128) / 255 / scale)];
    }

    private lookup(tag: number, input: ReadonlyArray<number>, toConnection: boolean): Array<number> {
        switch (this.signature(tag)) {
            case "mft1":
                return this.table(tag, input, 1, toConnection);
            case "mft2":
                return this.table(tag, input, 2, toConnection);
            case "mAB ":
                return this.elements(tag, input, true);
            case "mBA ":
                return this.elements(tag, input, false);
            default:
                throw new RangeError("The transform tag has a type that is not a lookup table");
        }
    }

    private table(tag: number, input: ReadonlyArray<number>, bytes: number, toConnection: boolean): Array<number> {
        // ICC.1:2022 §10.10 and §10.11: (matrix), input tables, CLUT and output tables, all with a domain and a range of 0
        // to 1; the matrix "shall be an identity matrix unless the input is in the PCSXYZ colour space".
        const inputs: number = this.view.getUint8(tag + 8);
        const outputs: number = this.view.getUint8(tag + 9);
        const grid: number = this.view.getUint8(tag + 10);
        const inputEntries: number = bytes === 2 ? this.view.getUint16(tag + 48) : 256;
        const outputEntries: number = bytes === 2 ? this.view.getUint16(tag + 50) : 256;
        const inputTables: number = tag + (bytes === 2 ? 52 : 48);
        const clut: number = inputTables + inputs * inputEntries * bytes;
        const outputTables: number = clut + Math.pow(grid, inputs) * outputs * bytes;
        const read: (offset: number) => number = (offset: number): number => bytes === 2 ? this.view.getUint16(offset) / 65535 : this.view.getUint8(offset) / 255;
        let values: Array<number> = [...input];
        if (!toConnection && this.connection === "xyz-d50" && inputs === 3) {
            values = [0, 1, 2].map((row: number) => this.clip([0, 1, 2].reduce((sum: number, column: number) => sum + this.fixed(tag + 12 + (row * 3 + column) * 4) * input[column], 0)));
        }
        values = values.map((value: number, channel: number) => this.sampled(inputEntries, value, (entry: number) => read(inputTables + (channel * inputEntries + entry) * bytes)));
        values = this.interpolated(new Array<number>(inputs).fill(grid), values, outputs, (index: number) => read(clut + index * bytes));
        return values.map((value: number, channel: number) => this.sampled(outputEntries, value, (entry: number) => read(outputTables + (channel * outputEntries + entry) * bytes)));
    }

    private elements(tag: number, input: ReadonlyArray<number>, toConnection: boolean): Array<number> {
        // ICC.1:2022 §10.12: "A" curves, CLUT, "M" curves, matrix and "B" curves from device to PCS; §10.13: the same in
        // the opposite order from PCS to device. An offset of zero means that the element is not there.
        const outputs: number = this.view.getUint8(tag + 9);
        const offsets: Array<number> = [12, 16, 20, 24, 28].map((position: number) => this.view.getUint32(tag + position));
        const [bCurves, matrix, mCurves, clut, aCurves]: Array<number> = offsets.map((offset: number) => offset === 0 ? 0 : tag + offset);
        let values: Array<number> = [...input];
        if (toConnection) {
            values = this.curves(aCurves, values);
            values = clut === 0 ? values : this.gridLookup(clut, values, outputs);
            values = this.curves(mCurves, values);
            values = matrix === 0 ? values : this.offsetMatrix(matrix, values);
            return this.curves(bCurves, values);
        }
        values = this.curves(bCurves, values);
        values = matrix === 0 ? values : this.offsetMatrix(matrix, values);
        values = this.curves(mCurves, values);
        values = clut === 0 ? values : this.gridLookup(clut, values, outputs);
        return this.curves(aCurves, values);
    }

    private curves(first: number, values: ReadonlyArray<number>): Array<number> {
        // ICC.1:2022 §10.12.2: the curves are stored one after the other, each one ending on a 4-byte boundary.
        if (first === 0) {
            return [...values];
        }
        let offset: number = first;
        return values.map((value: number) => {
            const result: number = this.curve(offset, value);
            offset += this.curveLength(offset);
            return result;
        });
    }

    private curveLength(offset: number): number {
        const length: number = this.signature(offset) === "para" ? 12 + 4 * PARAMETER_COUNTS[this.view.getUint16(offset + 8)] : 12 + 2 * this.view.getUint32(offset + 8);
        return Math.ceil(length / 4) * 4;
    }

    private offsetMatrix(offset: number, values: ReadonlyArray<number>): Array<number> {
        // ICC.1:2022 §10.12.5: a 3 x 4 array, the last three elements added to the product, and the results "clipped to
        // the range 0,0 to 1,0".
        return [0, 1, 2].map((row: number) => this.clip(this.fixed(offset + (9 + row) * 4)
            + [0, 1, 2].reduce((sum: number, column: number) => sum + this.fixed(offset + (row * 3 + column) * 4) * values[column], 0)));
    }

    private gridLookup(offset: number, values: ReadonlyArray<number>, outputs: number): Array<number> {
        // ICC.1:2022 §10.12.3: the grid points of each dimension in the first 16 bytes, the precision in bytes at 16,
        // and the data at 20.
        const grid: Array<number> = values.map((value: number, channel: number) => this.view.getUint8(offset + channel));
        const bytes: number = this.view.getUint8(offset + 16);
        return this.interpolated(grid, values, outputs, (index: number) =>
            bytes === 2 ? this.view.getUint16(offset + 20 + index * 2) / 65535 : this.view.getUint8(offset + 20 + index) / 255);
    }

    private interpolated(grid: ReadonlyArray<number>, values: ReadonlyArray<number>, outputs: number, read: (index: number) => number): Array<number> {
        // ICC.1:2022 §10.10: the first input channel "varies least rapidly" and the last one most rapidly, and each grid
        // point holds one value for each output channel; values between grid points come from linear interpolation.
        let base: number = 0;
        let stride: number = 1;
        // A value on a grid point reads one plane, so only the channels between two points double the corners.
        const between: Array<readonly [number, number]> = [];
        for (let channel: number = grid.length - 1; channel >= 0; channel--) {
            const position: number = this.clip(values[channel]) * (grid[channel] - 1);
            const cell: number = Math.min(Math.floor(position), Math.max(0, grid[channel] - 2));
            const fraction: number = position - cell;
            base += (fraction === 1 ? cell + 1 : cell) * stride;
            if (fraction > 0 && fraction < 1) {
                between.push([stride, fraction]);
            }
            stride *= grid[channel];
        }
        const result: Array<number> = new Array<number>(outputs).fill(0);
        for (let corner: number = 0; corner < (1 << between.length); corner++) {
            let weight: number = 1;
            let index: number = base;
            for (let at: number = 0; at < between.length; at++) {
                const upper: boolean = ((corner >> at) & 1) === 1;
                weight *= upper ? between[at][1] : 1 - between[at][1];
                index += upper ? between[at][0] : 0;
            }
            for (let output: number = 0; output < outputs; output++) {
                result[output] += weight * read(index * outputs + output);
            }
        }
        return result;
    }

    private sampled(entries: number, value: number, read: (entry: number) => number): number {
        // ICC.1:2022 §10.6: the first entry stands for 0, the last one for 1, and "Function values between the entries
        // shall be obtained through linear interpolation."
        const position: number = this.clip(value) * (entries - 1);
        const entry: number = Math.min(Math.floor(position), Math.max(0, entries - 2));
        const next: number = Math.min(entry + 1, entries - 1);
        return read(entry) + (read(next) - read(entry)) * (position - entry);
    }

    private curve(offset: number, value: number): number {
        if (this.signature(offset) === "para") {
            return this.parametric(offset, value);
        }
        // ICC.1:2022 §10.6: no entry is the identity, one entry is a gamma as a u8Fixed8Number, more are samples.
        const entries: number = this.view.getUint32(offset + 8);
        if (entries === 0) {
            return value;
        }
        if (entries === 1) {
            return Math.pow(value, this.view.getUint16(offset + 12) / 256);
        }
        return this.sampled(entries, value, (entry: number) => this.view.getUint16(offset + 12 + entry * 2) / 65535);
    }

    private parametric(offset: number, x: number): number {
        // ICC.1:2022 §10.18, Table 68; "Any function value outside the range shall be clipped to the range of the function."
        const type: number = this.view.getUint16(offset + 8);
        const parameter: (index: number) => number = (index: number): number => this.fixed(offset + 12 + index * 4);
        const g: number = parameter(0);
        const a: number = type > 0 ? parameter(1) : 1;
        const b: number = type > 0 ? parameter(2) : 0;
        const power: number = Math.pow(a * x + b, g);
        switch (type) {
            case 0:
                return this.clip(Math.pow(x, g));
            case 1:
                return this.clip(x >= -b / a ? power : 0);
            case 2:
                return this.clip(x >= -b / a ? power + parameter(3) : parameter(3));
            case 3:
                return this.clip(x >= parameter(4) ? power : parameter(3) * x);
            case 4:
                return this.clip(x >= parameter(4) ? power + parameter(5) : parameter(3) * x + parameter(6));
            default:
                throw new RangeError("The parametric curve has a function type that is not defined");
        }
    }

    private inverseCurve(offset: number, value: number): number {
        // Annex F.1: on a flat part the inverse is the highest x that gives the value, or the lowest one when the flat part
        // reaches the end of the domain; a value that the curve does not give takes the closest one it gives.
        const start: number = this.curve(offset, 0);
        const end: number = this.curve(offset, 1);
        const rising: boolean = end >= start;
        const target: number = Math.min(Math.max(value, Math.min(start, end)), Math.max(start, end));
        const atEnd: boolean = target === end;
        let low: number = 0;
        let high: number = 1;
        for (let middle: number = 0.5; middle !== low && middle !== high; middle = (low + high) / 2) {
            const sample: number = this.curve(offset, middle);
            const before: boolean = atEnd ? (rising ? sample < target : sample > target) : (rising ? sample <= target : sample >= target);
            if (before) {
                low = middle;
            } else {
                high = middle;
            }
        }
        return atEnd ? high : low;
    }

    private inverted(matrix: ReadonlyArray<ReadonlyArray<number>>): Array<Array<number>> | undefined {
        const [a, b, c]: ReadonlyArray<number> = matrix[0];
        const [d, e, f]: ReadonlyArray<number> = matrix[1];
        const [g, h, i]: ReadonlyArray<number> = matrix[2];
        const determinant: number = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
        if (determinant === 0) {
            return undefined;
        }
        return [
            [(e * i - f * h) / determinant, (c * h - b * i) / determinant, (b * f - c * e) / determinant],
            [(f * g - d * i) / determinant, (a * i - c * g) / determinant, (c * d - a * f) / determinant],
            [(d * h - e * g) / determinant, (b * g - a * h) / determinant, (a * e - b * d) / determinant]
        ];
    }

    private fixed(offset: number): number {
        return this.view.getInt32(offset) / 65536;
    }

    private signature(offset: number): string {
        return String.fromCharCode(this.view.getUint8(offset), this.view.getUint8(offset + 1), this.view.getUint8(offset + 2), this.view.getUint8(offset + 3));
    }

    private clip(value: number): number {
        return Number.isNaN(value) ? 0 : Math.min(1, Math.max(0, value));
    }
}
