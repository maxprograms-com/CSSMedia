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

interface HuffmanTable {
    values: Uint8Array;
    minCode: Int32Array;
    maxCode: Int32Array;
    valuePtr: Int32Array;
}

interface ProgressiveBand {
    from: number;
    to: number;
    low: number;
}

interface FrameComponent {
    id: number;
    horizontal: number;
    vertical: number;
    quantization: number;
    width: number;
    height: number;
    blocksAcross: number;
    blocksDown: number;
    trueAcross: number;
    trueDown: number;
    allocatedRows: number;
    coefficients?: Int32Array;
    planeWidth: number;
    dcLow: number;
    bands: Array<ProgressiveBand>;
    pointTransform: number;
}

interface ScanComponent {
    component: FrameComponent;
    dcTable: HuffmanTable | undefined;
    acTable: HuffmanTable | undefined;
    pred: number;
    dcBase: number;
    acBase: number;
    dcU: number;
    dcL: number;
    acKx: number;
    lastDifference: number;
    leftDifference: number;
    aboveDifferences: Int32Array;
    intervalStartY: number;
    llBase: number;
}

interface DhpComponent {
    id: number;
    horizontal: number;
    vertical: number;
}

interface ImagePlane {
    plane: Int32Array;
    width: number;
    height: number;
}

interface OutputPlane {
    id: number;
    plane: Int32Array;
    width: number;
    horizontal: number;
    vertical: number;
}

export interface JpegSamples {
    width: number;
    height: number;
    components: number;
    bits: number;
    colorSpace: "gray" | "rgb" | "cmyk" | "multi";
    pixels: Uint16Array;
}

const ZIGZAG: Uint8Array = Uint8Array.of(0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63);
const EMPTY: Buffer = Buffer.alloc(0);
const RED: number = 0x52;
const GREEN: number = 0x47;
const BLUE: number = 0x42;
const DC_BINS: number = 49;
const AC_BINS: number = 245;
const LOSSLESS_BINS: number = 158;
const FIXED_INTERVAL: number = 0x5A1D;
const QE: Uint16Array = Uint16Array.of(0x5A1D, 0x2586, 0x1114, 0x080B, 0x03D8, 0x01DA, 0x00E5, 0x006F, 0x0036, 0x001A, 0x000D, 0x0006, 0x0003, 0x0001, 0x5A7F, 0x3F25, 0x2CF2, 0x207C, 0x17B9, 0x1182, 0x0CEF, 0x09A1, 0x072F, 0x055C, 0x0406, 0x0303, 0x0240, 0x01B1, 0x0144, 0x00F5, 0x00B7, 0x008A, 0x0068, 0x004E, 0x003B, 0x002C, 0x5AE1, 0x484C, 0x3A0D, 0x2EF1, 0x261F, 0x1F33, 0x19A8, 0x1518, 0x1177, 0x0E74, 0x0BFB, 0x09F8, 0x0861, 0x0706, 0x05CD, 0x04DE, 0x040F, 0x0363, 0x02D4, 0x025C, 0x01F8, 0x01A4, 0x0160, 0x0125, 0x00F6, 0x00CB, 0x00AB, 0x008F, 0x5B12, 0x4D04, 0x412C, 0x37D8, 0x2FE8, 0x293C, 0x2379, 0x1EDF, 0x1AA9, 0x174E, 0x1424, 0x119C, 0x0F6B, 0x0D51, 0x0BB6, 0x0A40, 0x5832, 0x4D1C, 0x438E, 0x3BDD, 0x34EE, 0x2EAE, 0x299A, 0x2516, 0x5570, 0x4CA9, 0x44D9, 0x3E22, 0x3824, 0x32B4, 0x2E17, 0x56A8, 0x4F46, 0x47E5, 0x41CF, 0x3C3D, 0x375E, 0x5231, 0x4C0F, 0x4639, 0x415E, 0x5627, 0x50E7, 0x4B85, 0x5597, 0x504F, 0x5A10, 0x5522, 0x59EB);
const NEXT_LPS: Uint8Array = Uint8Array.of(1, 14, 16, 18, 20, 23, 25, 28, 30, 33, 35, 9, 10, 12, 15, 36, 38, 39, 40, 42, 43, 45, 46, 48, 49, 51, 52, 54, 56, 57, 59, 60, 62, 63, 32, 33, 37, 64, 65, 67, 68, 69, 70, 72, 73, 74, 75, 77, 78, 79, 48, 50, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 61, 61, 65, 80, 81, 82, 83, 84, 86, 87, 87, 72, 72, 74, 74, 75, 77, 77, 80, 88, 89, 90, 91, 92, 93, 86, 88, 95, 96, 97, 99, 99, 93, 95, 101, 102, 103, 104, 99, 105, 106, 107, 103, 105, 108, 109, 110, 111, 110, 112, 112);
const NEXT_MPS: Uint8Array = Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 13, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 9, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 32, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 48, 81, 82, 83, 84, 85, 86, 87, 71, 89, 90, 91, 92, 93, 94, 86, 96, 97, 98, 99, 100, 93, 102, 103, 104, 99, 106, 107, 103, 109, 107, 111, 109, 111);
const EXCHANGE: Uint8Array = Uint8Array.of(1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1);

export class JpegDecoder {

    readonly diagnostics: Array<string> = [];

    private data: Buffer = EMPTY;
    private position: number = 0;
    private byte: number = 0;
    private count: number = 0;
    private restartInterval: number = 0;
    private width: number = 0;
    private height: number = 0;
    private precision: number = 8;
    private horizontalMax: number = 1;
    private verticalMax: number = 1;
    private adobeTransform: number | undefined;
    private frameParsed: boolean = false;
    private progressive: boolean = false;
    private lossless: boolean = false;
    private differential: boolean = false;
    private hierarchical: boolean = false;
    private pendingLines: boolean = false;
    private huffmanStalled: boolean = false;
    private scansDone: number = 0;
    private framesSeen: number = 0;
    private firstInterleaved: boolean = false;
    private firstRows: number = 0;
    private firstComponent: FrameComponent | undefined;
    private scanKind: "sequential" | "dcFirst" | "dcRefine" | "acFirst" | "acRefine" | "lossless" = "sequential";
    private scanFrom: number = 0;
    private scanTo: number = 63;
    private scanLow: number = 0;
    private eobRun: number = 0;
    private arithmetic: boolean = false;
    private interval: number = 0;
    private code: number = 0;
    private codeCount: number = 0;
    private stalled: boolean = false;
    private dhpPrecision: number = 8;
    private dhpWidth: number = 0;
    private dhpHeight: number = 0;
    private expansionHorizontal: boolean = false;
    private expansionVertical: boolean = false;
    private readonly dhpComponents: Array<DhpComponent> = [];
    private readonly references: Map<number, ImagePlane> = new Map<number, ImagePlane>();
    private readonly arithmeticState: Uint8Array = new Uint8Array(4 * DC_BINS + 4 * AC_BINS + 4 * LOSSLESS_BINS);
    private readonly dcConditioning: Array<readonly [number, number]> = [[1, 0], [1, 0], [1, 0], [1, 0]];
    private readonly acConditioning: Array<number> = [5, 5, 5, 5];
    private readonly components: Array<FrameComponent> = [];
    private readonly quantization: Array<Uint16Array | undefined> = [];
    private readonly wideQuantization: Set<number> = new Set<number>();
    private readonly dcTables: Array<HuffmanTable | undefined> = [];
    private readonly acTables: Array<HuffmanTable | undefined> = [];
    private readonly rows: Float64Array = new Float64Array(64);

    samples(data: Buffer): JpegSamples | undefined {
        this.reset(data);
        try {
            this.markers();
            return this.assemble();
        } catch (error: unknown) {
            this.report(error instanceof Error ? error.message : String(error));
            return undefined;
        }
    }

    private reset(data: Buffer): void {
        this.data = data;
        this.position = 0;
        this.byte = 0;
        this.count = 0;
        this.restartInterval = 0;
        this.width = 0;
        this.height = 0;
        this.precision = 8;
        this.horizontalMax = 1;
        this.verticalMax = 1;
        this.adobeTransform = undefined;
        this.frameParsed = false;
        this.progressive = false;
        this.lossless = false;
        this.differential = false;
        this.hierarchical = false;
        this.pendingLines = false;
        this.huffmanStalled = false;
        this.scansDone = 0;
        this.framesSeen = 0;
        this.firstInterleaved = false;
        this.firstRows = 0;
        this.firstComponent = undefined;
        this.scanKind = "sequential";
        this.scanFrom = 0;
        this.scanTo = 63;
        this.scanLow = 0;
        this.eobRun = 0;
        this.arithmetic = false;
        this.stalled = false;
        this.dhpPrecision = 8;
        this.dhpWidth = 0;
        this.dhpHeight = 0;
        this.expansionHorizontal = false;
        this.expansionVertical = false;
        this.dhpComponents.length = 0;
        this.references.clear();
        for (let index: number = 0; index < 4; index++) {
            this.dcConditioning[index] = [1, 0];
            this.acConditioning[index] = 5;
        }
        this.components.length = 0;
        this.quantization.length = 0;
        this.wideQuantization.clear();
        this.dcTables.length = 0;
        this.acTables.length = 0;
    }

    private report(message: string): void {
        const text: string = "The JPEG image " + message;
        if (!this.diagnostics.includes(text)) {
            this.diagnostics.push(text);
        }
    }

    private markers(): void {
        const data: Buffer = this.data;
        if (data.length < 2 || data[0] !== 0xFF || data[1] !== 0xD8) {
            throw new Error("does not begin with the SOI marker");
        }
        this.position = 2;
        while (this.position + 1 < data.length) {
            // ITU-T T.81 §B.1.1.2: any number of fill bytes X'FF' may precede a marker.
            while (data[this.position + 1] === 0xFF && data[this.position] === 0xFF) {
                this.position++;
            }
            if (data[this.position] !== 0xFF) {
                throw new Error("holds no marker at byte " + this.position);
            }
            const code: number = data[this.position + 1];
            this.position += 2;
            if (code === 0xD9) {
                return;
            }
            if (code !== 0x01 && (code < 0xD0 || code > 0xD7)) {
                if (this.position + 2 > data.length) {
                    throw new Error("ends inside the segment of the marker FF" + code.toString(16).toUpperCase());
                }
                const length: number = data.readUInt16BE(this.position);
                if (length < 2) {
                    throw new Error("has the empty segment of the marker FF" + code.toString(16).toUpperCase());
                }
                const end: number = this.position + length;
                if (end > data.length) {
                    throw new Error("has the truncated segment of the marker FF" + code.toString(16).toUpperCase());
                }
                if (code === 0xDA) {
                    this.scan();
                } else {
                    this.segment(code, end);
                    this.position = end;
                }
            }
        }
    }

    private segment(code: number, end: number): void {
        switch (code) {
            case 0xC0:
            case 0xC1:
            case 0xC2:
            case 0xC3:
            case 0xC5:
            case 0xC6:
            case 0xC7:
            case 0xC9:
            case 0xCA:
            case 0xCB:
            case 0xCD:
            case 0xCE:
            case 0xCF:
                this.frame(code, end);
                return;
            case 0xC4:
                this.huffmanTables(end);
                return;
            case 0xCC:
                this.conditioning(end);
                return;
            case 0xDB:
                this.quantizationTables(end);
                return;
            case 0xDC:
                this.defineLines(end);
                return;
            case 0xDD:
                this.defineInterval(end);
                return;
            case 0xDE:
                this.progression(end);
                return;
            case 0xDF:
                this.expand(end);
                return;
            case 0xEE:
                this.adobe(end);
                return;
            default:
                return;
        }
    }

    private frame(code: number, end: number): void {
        if (this.frameParsed) {
            if (!this.hierarchical) {
                throw new Error("has more than one frame");
            }
            // ITU-T T.81 §J.2.1: each frame is reconstructed into references before the next one begins.
            this.finishFrame();
        }
        if (this.pendingLines) {
            // ITU-T T.81 §B.2.5: the DNL segment is mandatory when Y is zero; no later segment may supply it.
            throw new Error("defines its number of lines with a DNL segment, which never arrives");
        }
        this.framesSeen++;
        this.arithmetic = code === 0xC9 || code === 0xCA || code === 0xCB || code === 0xCD || code === 0xCE || code === 0xCF;
        this.progressive = code === 0xC2 || code === 0xCA || code === 0xC6 || code === 0xCE;
        this.lossless = code === 0xC3 || code === 0xC7 || code === 0xCB || code === 0xCF;
        this.differential = code === 0xC5 || code === 0xC6 || code === 0xC7 || code === 0xCD || code === 0xCE || code === 0xCF;
        if (this.differential && !this.hierarchical) {
            throw new Error("has a differential frame outside the hierarchical mode");
        }
        if (this.expansionHorizontal || this.expansionVertical) {
            if (!this.differential) {
                throw new Error("expands its references outside a differential frame");
            }
            // ITU-T T.81 §J.1.1 and §J.1.1.2: the frame upsamples its references as the EXP segment requires, horizontally first
            // and then vertically.
            for (const [id, reference] of this.references) {
                this.references.set(id, this.upsample(reference, this.expansionHorizontal, this.expansionVertical));
            }
            this.expansionHorizontal = false;
            this.expansionVertical = false;
        }
        const data: Buffer = this.data;
        const at: number = this.position + 2;
        if (end - this.position < 8) {
            throw new Error("has a frame header of " + (end - this.position) + " bytes");
        }
        const precision: number = data[at];
        if (this.lossless) {
            // ITU-T T.81 §H.1.1: "Input data precision may be from 2 to 16 bits/sample."
            if (precision < 2 || precision > 16) {
                throw new Error("has the sample precision " + precision + ", which lossless coding does not allow");
            }
        } else if (code === 0xC0 ? precision !== 8 : (precision !== 8 && precision !== 12)) {
            // ITU-T T.81 Table B.2: the baseline process is 8-bit, the other DCT processes 8 or 12.
            throw new Error("has the sample precision " + precision + ", which Table B.2 does not allow");
        }
        this.precision = precision;
        const lines: number = data.readUInt16BE(at + 1);
        const samples: number = data.readUInt16BE(at + 3);
        if (samples === 0) {
            throw new Error("has no samples per line");
        }
        const count: number = data[at + 5];
        if (count < 1 || (this.progressive && count > 4)) {
            // ITU-T T.81 Table B.2: Nf is 1 to 255, and 1 to 4 in the progressive mode.
            throw new Error("has " + count + " components");
        }
        if (end - this.position !== 8 + 3 * count) {
            throw new Error("has a frame header of " + (end - this.position) + " bytes, which Table B.2 does not allow");
        }
        this.horizontalMax = 1;
        this.verticalMax = 1;
        this.components.length = 0;
        const defined: Array<FrameComponent> = [];
        for (let index: number = 0; index < count; index++) {
            const base: number = at + 6 + 3 * index;
            const id: number = data[base];
            const horizontal: number = data[base + 1] >> 4;
            const vertical: number = data[base + 1] & 0x0F;
            const table: number = data[base + 2];
            if (horizontal < 1 || horizontal > 4 || vertical < 1 || vertical > 4) {
                throw new Error("has the sampling factors " + horizontal + " and " + vertical + " of the component " + id);
            }
            if (!this.lossless && table > 3) {
                throw new Error("has the quantization table destination " + table + " of the component " + id);
            }
            if (defined.some((component: FrameComponent): boolean => component.id === id)) {
                throw new Error("has two components named " + id);
            }
            this.horizontalMax = Math.max(this.horizontalMax, horizontal);
            this.verticalMax = Math.max(this.verticalMax, vertical);
            defined.push({
                id, horizontal, vertical, quantization: table, width: 0, height: 0, blocksAcross: 0, blocksDown: 0,
                trueAcross: 0, trueDown: 0, allocatedRows: 0, planeWidth: 0, dcLow: -1, bands: [], pointTransform: 0
            });
        }
        for (const component of defined) {
            if (!this.lossless && precision <= 8 && this.wideQuantization.has(component.quantization)) {
                // ITU-T T.81 §B.2.4.1: "An 8-bit DCT process shall not use a 16-bit precision quantization table."
                throw new Error("holds a 16-bit quantization table in an 8-bit process");
            }
            // ITU-T T.81 §A.1.1: xi = ceil(X * Hi / Hmax) and yi = ceil(Y * Vi / Vmax); §A.1.3: a lossless data unit is one sample.
            component.width = Math.ceil(samples * component.horizontal / this.horizontalMax);
            component.height = Math.ceil(lines * component.vertical / this.verticalMax);
            // ITU-T T.81 §A.2.2: a scan of one component covers its own data units; §A.2.3: an interleaved scan covers whole MCUs,
            // so the store of a component is padded to the MCUs.
            const unit: number = this.lossless ? 1 : 8;
            component.trueAcross = Math.ceil(component.width / unit);
            component.trueDown = Math.ceil(component.height / unit);
            component.blocksAcross = Math.ceil(samples / (unit * this.horizontalMax)) * component.horizontal;
            component.blocksDown = Math.ceil(lines / (unit * this.verticalMax)) * component.vertical;
            this.components.push(component);
        }
        this.width = samples;
        this.height = lines;
        this.pendingLines = lines === 0;
        this.scansDone = 0;
        this.frameParsed = true;
    }

    private defineLines(end: number): void {
        // ITU-T T.81 §B.2.5: the DNL segment gives or redefines Y at the end of the first scan, after whole MCU rows.
        if (end - this.position !== 4) {
            throw new Error("has a DNL segment of " + (end - this.position) + " bytes");
        }
        if (!this.frameParsed) {
            throw new Error("has a DNL segment before its frame");
        }
        if (this.scansDone !== 1) {
            throw new Error("has a DNL segment that does not follow the first scan");
        }
        const lines: number = this.data.readUInt16BE(this.position + 2);
        if (lines === 0) {
            throw new Error("defines zero lines in a DNL segment");
        }
        const unit: number = this.lossless ? 1 : 8;
        let expected: number;
        if (this.firstInterleaved) {
            expected = Math.ceil(lines / (unit * this.verticalMax));
        } else {
            const component: FrameComponent = this.firstComponent as FrameComponent;
            const height: number = Math.ceil(lines * component.vertical / this.verticalMax);
            expected = this.lossless ? height : Math.ceil(height / 8);
        }
        if (expected !== this.firstRows) {
            throw new Error("has a DNL segment inconsistent with the MCU rows of its first scan");
        }
        this.setLines(lines);
        this.pendingLines = false;
    }

    private setLines(lines: number): void {
        this.height = lines;
        for (const component of this.components) {
            component.height = Math.ceil(lines * component.vertical / this.verticalMax);
            const unit: number = this.lossless ? 1 : 8;
            const rows: number = Math.ceil(component.height / unit);
            if (rows > component.allocatedRows) {
                throw new Error("has a DNL segment with more lines than its first scan decoded");
            }
            component.trueDown = rows;
            const padded: number = Math.ceil(lines / (unit * this.verticalMax)) * component.vertical;
            this.ensureRows(component, padded);
            component.blocksDown = padded;
        }
    }

    private ensureRows(component: FrameComponent, rows: number): void {
        if (rows <= component.allocatedRows) {
            return;
        }
        // ITU-T T.81 §B.2.5: with Y = 0 the coefficient store grows by rows as the first scan decodes them.
        const unit: number = this.lossless ? 1 : 64;
        const larger: Int32Array = new Int32Array(component.blocksAcross * rows * unit);
        if (component.coefficients !== undefined) {
            larger.set(component.coefficients);
        }
        component.coefficients = larger;
        component.allocatedRows = rows;
    }

    private quantizationTables(end: number): void {
        const data: Buffer = this.data;
        let at: number = this.position + 2;
        while (at < end) {
            const precision: number = data[at] >> 4;
            const destination: number = data[at] & 0x0F;
            at++;
            if (destination > 3) {
                throw new Error("has the quantization table destination " + destination);
            }
            if (precision === 1 && this.frameParsed && this.precision <= 8) {
                // ITU-T T.81 §B.2.4.1: "An 8-bit DCT-based process shall not use a 16-bit precision quantization table."
                throw new Error("holds a 16-bit quantization table in an 8-bit process");
            }
            // A table may precede its frame header, so the frame header checks the tables that it uses.
            if (precision === 1) {
                this.wideQuantization.add(destination);
            } else {
                this.wideQuantization.delete(destination);
            }
            if (precision > 1) {
                throw new Error("holds a quantization table of the precision " + precision);
            }
            const width: number = precision === 1 ? 2 : 1;
            if (at + 64 * width > end) {
                throw new Error("has a truncated quantization table");
            }
            const table: Uint16Array = new Uint16Array(64);
            for (let k: number = 0; k < 64; k++) {
                const value: number = width === 2 ? data.readUInt16BE(at + k * 2) : data[at + k];
                if (value === 0) {
                    throw new Error("has the quantization value 0, which Table B.4 does not allow");
                }
                table[ZIGZAG[k]] = value;
            }
            this.quantization[destination] = table;
            at += 64 * width;
        }
    }

    private huffmanTables(end: number): void {
        const data: Buffer = this.data;
        let at: number = this.position + 2;
        while (at + 17 <= end) {
            const tableClass: number = data[at] >> 4;
            const destination: number = data[at] & 0x0F;
            if (tableClass > 1 || destination > 3) {
                throw new Error("has the Huffman table class " + tableClass + " in the destination " + destination);
            }
            const counts: Uint8Array = Uint8Array.from(data.subarray(at + 1, at + 17));
            let total: number = 0;
            for (let length: number = 0; length < 16; length++) {
                total += counts[length];
            }
            if (total > 256) {
                throw new Error("has a Huffman table of " + total + " values");
            }
            if (at + 17 + total > end) {
                throw new Error("has a truncated Huffman table");
            }
            const table: HuffmanTable = this.huffmanTable(counts, data.subarray(at + 17, at + 17 + total));
            if (tableClass === 0) {
                this.dcTables[destination] = table;
            } else {
                this.acTables[destination] = table;
            }
            at += 17 + total;
        }
        if (at !== end) {
            throw new Error("has a Huffman table segment with unused bytes");
        }
    }

    private huffmanTable(counts: Uint8Array, values: Uint8Array): HuffmanTable {
        // ITU-T T.81 §C.2: the codes of one length are consecutive and the next length shifts left; the values follow in order.
        const codes: Int32Array = new Int32Array(values.length);
        let code: number = 0;
        let index: number = 0;
        for (let length: number = 1; length <= 16; length++) {
            for (let repeat: number = 0; repeat < counts[length - 1]; repeat++) {
                codes[index] = code;
                code++;
                index++;
            }
            code <<= 1;
        }
        const minCode: Int32Array = new Int32Array(16);
        const maxCode: Int32Array = new Int32Array(16);
        const valuePtr: Int32Array = new Int32Array(16);
        let at: number = 0;
        for (let length: number = 0; length < 16; length++) {
            if (counts[length] === 0) {
                maxCode[length] = -1;
                continue;
            }
            // ITU-T T.81 §F.15: each length with codes gets VALPTR, MINCODE and MAXCODE; a length without codes keeps MAXCODE -1.
            valuePtr[length] = at;
            minCode[length] = codes[at];
            at += counts[length] - 1;
            maxCode[length] = codes[at];
            at++;
        }
        return { values, minCode, maxCode, valuePtr };
    }

    private defineInterval(end: number): void {
        if (end - this.position !== 4) {
            throw new Error("has a DRI segment of " + (end - this.position) + " bytes");
        }
        this.restartInterval = this.data.readUInt16BE(this.position + 2);
    }

    private adobe(end: number): void {
        const data: Buffer = this.data;
        const at: number = this.position + 2;
        if (end - at >= 12 && data[at] === 0x41 && data[at + 1] === 0x64 && data[at + 2] === 0x6F && data[at + 3] === 0x62 && data[at + 4] === 0x65) {
            // The Adobe APP14 segment: "Adobe", the version, two flags and the transform, 0 CMYK, 1 YCbCr and 2 YCCK.
            this.adobeTransform = data[at + 11];
        }
    }

    private progression(end: number): void {
        // ITU-T T.81 §B.3.2: the DHP segment has the syntax of a frame header and precedes any SOF; it sizes the completed image.
        if (this.hierarchical) {
            throw new Error("has two DHP segments");
        }
        if (this.framesSeen > 0) {
            throw new Error("has a DHP segment after a frame");
        }
        const data: Buffer = this.data;
        const at: number = this.position + 2;
        if (end - this.position < 8 || end - this.position > 8 + 3 * 255) {
            throw new Error("has a DHP segment of " + (end - this.position) + " bytes");
        }
        const precision: number = data[at];
        if (precision < 2 || precision > 16) {
            throw new Error("has the sample precision " + precision + " in its DHP segment");
        }
        const lines: number = data.readUInt16BE(at + 1);
        const samples: number = data.readUInt16BE(at + 3);
        const count: number = data[at + 5];
        if (lines === 0 || samples === 0 || count === 0) {
            throw new Error("has an empty DHP segment");
        }
        if (end - this.position !== 8 + 3 * count) {
            throw new Error("has a DHP segment of " + (end - this.position) + " bytes");
        }
        for (let index: number = 0; index < count; index++) {
            const base: number = at + 6 + 3 * index;
            const horizontal: number = data[base + 1] >> 4;
            const vertical: number = data[base + 1] & 0x0F;
            if (horizontal < 1 || horizontal > 4 || vertical < 1 || vertical > 4) {
                throw new Error("has the sampling factors " + horizontal + " and " + vertical + " in its DHP segment");
            }
            if (this.dhpComponents.some((component: DhpComponent): boolean => component.id === data[base])) {
                throw new Error("has two components named " + data[base] + " in its DHP segment");
            }
            this.dhpComponents.push({ id: data[base], horizontal, vertical });
        }
        this.dhpPrecision = precision;
        this.dhpWidth = samples;
        this.dhpHeight = lines;
        this.hierarchical = true;
    }

    private expand(end: number): void {
        // ITU-T T.81 §B.3.3: the expansion parameters apply only to the next frame, which shall be a differential frame.
        if (end - this.position !== 3) {
            throw new Error("has an EXP segment of " + (end - this.position) + " bytes");
        }
        if (!this.hierarchical) {
            throw new Error("expands its references outside the hierarchical mode");
        }
        if (this.expansionHorizontal || this.expansionVertical) {
            // ITU-T T.81 §J.1.1: "No more than one EXP marker segment shall precede a given frame."
            throw new Error("has two EXP segments before a frame");
        }
        const flags: number = this.data[this.position + 2];
        const horizontal: number = flags >> 4;
        const vertical: number = flags & 0x0F;
        if (horizontal > 1 || vertical > 1) {
            throw new Error("has the expansion factors " + horizontal + " and " + vertical);
        }
        if (horizontal === 0 && vertical === 0) {
            throw new Error("expands its references by zero");
        }
        this.expansionHorizontal = horizontal === 1;
        this.expansionVertical = vertical === 1;
    }

    private upsample(reference: ImagePlane, horizontal: boolean, vertical: boolean): ImagePlane {
        // ITU-T T.81 §J.1.1.2: Px = (Ra + Rb) / 2 with truncation; the left column and top line match, the right column and bottom
        // line of the lower resolution are replicated.
        let plane: Int32Array = reference.plane;
        let width: number = reference.width;
        let height: number = reference.height;
        if (horizontal) {
            const doubled: Int32Array = new Int32Array(width * 2 * height);
            for (let row: number = 0; row < height; row++) {
                const source: number = row * width;
                const target: number = row * width * 2;
                for (let x: number = 0; x < width; x++) {
                    doubled[target + x * 2] = plane[source + x];
                    const right: number = x + 1 < width ? plane[source + x + 1] : plane[source + x];
                    doubled[target + x * 2 + 1] = (plane[source + x] + right) >> 1;
                }
            }
            plane = doubled;
            width *= 2;
        }
        if (vertical) {
            const doubled: Int32Array = new Int32Array(width * height * 2);
            for (let row: number = 0; row < height; row++) {
                doubled.set(plane.subarray(row * width, row * width + width), row * 2 * width);
                const below: number = row + 1 < height ? row + 1 : row;
                for (let x: number = 0; x < width; x++) {
                    doubled[row * 2 * width + width + x] = (plane[row * width + x] + plane[below * width + x]) >> 1;
                }
            }
            plane = doubled;
            height *= 2;
        }
        return { plane, width, height };
    }

    private finishFrame(): void {
        if (!this.frameParsed) {
            return;
        }
        for (const component of this.components) {
            const store: Int32Array | undefined = component.coefficients;
            if (store === undefined || component.dcLow === -1) {
                throw new Error("has the component " + component.id + " in no scan");
            }
            // ITU-T T.81 §J.1.1.2: the edge samples of the lower resolution image are replicated, so a reference keeps the size of
            // its component and not the padding of its last blocks.
            const plane: ImagePlane = this.crop(this.lossless ? this.losslessPlane(component) : this.transformPlane(component), component.width, component.height);
            if (this.differential) {
                const reference: ImagePlane | undefined = this.references.get(component.id);
                if (reference === undefined) {
                    throw new Error("has a differential frame with no reference component " + component.id);
                }
                if (reference.width !== plane.width || reference.height !== plane.height) {
                    throw new Error("has a differential frame that does not match the resolution of the component " + component.id);
                }
                // ITU-T T.81 §J.2.1: the differential components are added, modulo 2^16, to the upsampled reference components.
                const combined: Int32Array = new Int32Array(reference.plane.length);
                for (let index: number = 0; index < combined.length; index++) {
                    combined[index] = (reference.plane[index] + plane.plane[index]) & 0xFFFF;
                }
                this.references.set(component.id, { plane: combined, width: plane.width, height: plane.height });
            } else {
                this.references.set(component.id, plane);
            }
        }
        this.frameParsed = false;
    }

    private crop(source: ImagePlane, width: number, height: number): ImagePlane {
        if (source.width === width && source.height === height) {
            return source;
        }
        const plane: Int32Array = new Int32Array(width * height);
        for (let row: number = 0; row < height; row++) {
            plane.set(source.plane.subarray(row * source.width, row * source.width + width), row * width);
        }
        return { plane, width, height };
    }

    private scan(): void {
        if (!this.frameParsed) {
            throw new Error("has a scan before its frame");
        }
        if (this.expansionHorizontal || this.expansionVertical) {
            // ITU-T T.81 §B.3.3: the EXP segment never precedes a scan header or a DHP segment.
            throw new Error("has an EXP segment inside a frame");
        }
        if (this.pendingLines && this.scansDone !== 0) {
            // ITU-T T.81 §B.2.5: the DNL segment is mandatory when the frame header declares the value zero for Y.
            throw new Error("defines its number of lines with a DNL segment, which never arrives");
        }
        this.scansDone++;
        const data: Buffer = this.data;
        const at: number = this.position;
        const length: number = data.readUInt16BE(at);
        if (length < 6) {
            throw new Error("has a scan header of " + length + " bytes");
        }
        const count: number = data[at + 2];
        if (count < 1 || count > 4) {
            throw new Error("has a scan of " + count + " components");
        }
        if (length !== 6 + 2 * count) {
            throw new Error("has a scan header of " + length + " bytes, which Table B.3 does not allow");
        }
        const first: number = at + 3 + 2 * count;
        const from: number = data[first];
        const to: number = data[first + 1];
        const high: number = data[first + 2] >> 4;
        const low: number = data[first + 2] & 0x0F;
        this.scanKind = this.scanKindOf(from, to, high, low, count);
        this.scanFrom = from;
        this.scanTo = to;
        this.scanLow = low;
        this.eobRun = 0;
        this.huffmanStalled = false;
        const interleaved: boolean = count > 1;
        const scanComponents: Array<ScanComponent> = [];
        let blocks: number = 0;
        for (let index: number = 0; index < count; index++) {
            const base: number = at + 3 + 2 * index;
            const selector: number = data[base];
            const component: FrameComponent | undefined = this.components.find((item: FrameComponent): boolean => item.id === selector);
            if (component === undefined) {
                throw new Error("has a scan that selects the unknown component " + selector);
            }
            this.select(component, from, to, high, low);
            const dcId: number = data[base + 1] >> 4;
            const acId: number = data[base + 1] & 0x0F;
            if (this.lossless && acId !== 0) {
                // ITU-T T.81 Table B.3: the AC table destination of a lossless scan is zero.
                throw new Error("has the AC table destination " + acId + " in a lossless scan");
            }
            const needsDc: boolean = !this.arithmetic && (this.scanKind === "sequential" || this.scanKind === "dcFirst" || this.scanKind === "lossless");
            const needsAc: boolean = !this.arithmetic && (this.scanKind === "sequential" || this.scanKind === "acFirst" || this.scanKind === "acRefine");
            const dcTable: HuffmanTable | undefined = needsDc ? this.dcTables[dcId] : undefined;
            const acTable: HuffmanTable | undefined = needsAc ? this.acTables[acId] : undefined;
            if (needsDc && dcTable === undefined) {
                throw new Error("has a scan of the component " + selector + " without its DC table");
            }
            if (needsAc && acTable === undefined) {
                throw new Error("has a scan of the component " + selector + " without its AC table");
            }
            if (component.coefficients === undefined) {
                const unit: number = this.lossless ? 1 : 64;
                const rows: number = this.pendingLines ? 0 : component.blocksDown;
                component.coefficients = new Int32Array(component.blocksAcross * rows * unit);
                component.allocatedRows = rows;
            }
            if (this.lossless) {
                component.pointTransform = low;
            }
            scanComponents.push({
                component, dcTable, acTable, pred: 0, dcBase: dcId * DC_BINS, acBase: 4 * DC_BINS + acId * AC_BINS,
                dcU: this.dcConditioning[dcId][0], dcL: this.dcConditioning[dcId][1], acKx: this.acConditioning[acId], lastDifference: 0,
                leftDifference: 0, aboveDifferences: new Int32Array(component.blocksAcross), intervalStartY: 0,
                llBase: 4 * DC_BINS + 4 * AC_BINS + dcId * LOSSLESS_BINS
            });
            blocks += component.horizontal * component.vertical;
        }
        if (interleaved && blocks > 10) {
            throw new Error("has an interleaved scan of " + blocks + " data units per MCU");
        }
        const unit: number = this.lossless ? 1 : 8;
        let across: number;
        if (interleaved) {
            // ITU-T T.81 §A.1.1 and §A.2.3: an MCU spans Hmax data units; a lossless data unit is one sample, a DCT data unit 8.
            across = Math.ceil(this.width / (unit * this.horizontalMax));
        } else {
            across = scanComponents[0].component.trueAcross;
        }
        if (this.scansDone === 1) {
            this.firstInterleaved = interleaved;
            this.firstComponent = scanComponents[0].component;
        }
        this.position = at + length;
        this.count = 0;
        if (this.arithmetic) {
            this.arithmeticInit();
        }
        if (this.pendingLines) {
            this.pendingScan(scanComponents, interleaved, across);
            this.alignToMarker();
            return;
        }
        this.fixedScan(scanComponents, interleaved, across, unit);
        this.alignToMarker();
    }

    private alignToMarker(): void {
        // ITU-T T.81 §B.1.1.5: the entropy-coded segment ends at the next marker; any X'FF' followed by X'00' is a stuffed literal.
        this.count = 0;
        const data: Buffer = this.data;
        while (this.position < data.length) {
            if (data[this.position] !== 0xFF) {
                this.position++;
                continue;
            }
            if (this.position + 1 >= data.length || data[this.position + 1] !== 0x00) {
                return;
            }
            this.position += 2;
        }
    }

    private fixedScan(scanComponents: ReadonlyArray<ScanComponent>, interleaved: boolean, across: number, unit: number): void {
        let down: number;
        if (interleaved) {
            down = Math.ceil(this.height / (unit * this.verticalMax));
        } else {
            down = scanComponents[0].component.trueDown;
        }
        if (this.scansDone === 1) {
            this.firstRows = down;
        }
        const total: number = across * down;
        const interval: number = this.restartInterval > 0 ? this.restartInterval : total;
        let done: number = 0;
        let marker: number = 0;
        while (done < total) {
            const inInterval: number = Math.min(interval, total - done);
            for (let index: number = 0; index < inInterval; index++) {
                const mcu: number = done + index;
                this.mcu(scanComponents, interleaved, mcu % across, Math.floor(mcu / across));
            }
            done += inInterval;
            if (done < total) {
                // ITU-T T.81 §E.2.4 and §F.2.1.3.1: each restart marker is read at a byte boundary and resets the decoder.
                this.expectRestart(marker);
                marker = (marker + 1) % 8;
                this.resetPredictions(scanComponents, Math.floor(done / across), interleaved);
            }
        }
    }

    private pendingScan(scanComponents: ReadonlyArray<ScanComponent>, interleaved: boolean, across: number): void {
        // ITU-T T.81 §B.2.5: with Y = 0 the first scan ends at its marker and the DNL segment that follows gives the lines.
        const interval: number = this.restartInterval > 0 ? this.restartInterval : Number.MAX_SAFE_INTEGER;
        let marker: number = 0;
        let intervalCount: number = 0;
        let row: number = 0;
        for (; ;) {
            for (const scanComponent of scanComponents) {
                // ITU-T T.81 §A.2.4: the encoder pads the image to whole MCUs; the rows grow as the scan decodes them.
                const step: number = interleaved ? scanComponent.component.vertical : 1;
                this.ensureRows(scanComponent.component, (row + 1) * step);
            }
            for (let column: number = 0; column < across; column++) {
                if (this.stalled || this.huffmanStalled) {
                    this.firstRows = row;
                    return;
                }
                if (intervalCount === interval) {
                    this.expectRestart(marker);
                    marker = (marker + 1) % 8;
                    this.resetPredictions(scanComponents, row, interleaved);
                    intervalCount = 0;
                }
                try {
                    this.mcu(scanComponents, interleaved, column, row);
                } catch (error: unknown) {
                    if (!this.stalled && !this.huffmanStalled) {
                        throw error;
                    }
                    // The marker ends the scan inside the block it interrupts, and that row does not count.
                    this.firstRows = row;
                    return;
                }
                intervalCount++;
            }
            row++;
        }
    }

    private resetPredictions(scanComponents: ReadonlyArray<ScanComponent>, row: number, interleaved: boolean): void {
        for (const scanComponent of scanComponents) {
            scanComponent.pred = 0;
            if (this.lossless) {
                // ITU-T T.81 §H.1.2.1: the restart begins a first line; §H.1.2.3.1: the conditioning above starts at zero.
                scanComponent.leftDifference = 0;
                scanComponent.aboveDifferences.fill(0);
                scanComponent.intervalStartY = row * (interleaved ? scanComponent.component.vertical : 1);
            }
        }
        this.eobRun = 0;
        if (this.arithmetic) {
            this.arithmeticInit();
            for (const scanComponent of scanComponents) {
                scanComponent.pred = 0;
                scanComponent.lastDifference = 0;
            }
        }
    }

    private scanKindOf(from: number, to: number, high: number, low: number, count: number): "sequential" | "dcFirst" | "dcRefine" | "acFirst" | "acRefine" | "lossless" {
        if (this.lossless) {
            if (from > 7 || (from === 0 && !this.differential) || (this.differential && from !== 0)) {
                // ITU-T T.81 Table H.1: the predictors are 1 to 7; §H.1.2.1: selection 0 belongs to the differential coding of
                // the hierarchical mode, which §J.1.3.2 requires.
                throw new Error("has the predictor " + from + " in a lossless scan");
            }
            if (to !== 0 || high !== 0 || low > 15) {
                // ITU-T T.81 §B.2.3: a lossless scan has Se 0, Ah 0 and the point transform Al 0 to 15.
                throw new Error("has the lossless parameters Se " + to + ", Ah " + high + " and Al " + low);
            }
            return "lossless";
        }
        if (!this.progressive) {
            if (from !== 0 || to !== 63 || high !== 0 || low !== 0) {
                // ITU-T T.81 §B.2.3: a sequential DCT scan has Ss 0, Se 63, Ah 0 and Al 0; anything else belongs to the progressive mode.
                throw new Error("has a scan that is not a sequential DCT scan");
            }
            return "sequential";
        }
        if (low > 13 || high > 13) {
            throw new Error("has the successive approximation positions " + high + " and " + low);
        }
        if (from === 0) {
            if (to !== 0) {
                throw new Error("has a DC scan that selects the AC coefficients up to " + to);
            }
            return high === 0 ? "dcFirst" : "dcRefine";
        }
        // ITU-T T.81 §G.1.1.1.1: "only scans which code DC coefficients may have interleaved blocks"; an AC scan holds one component.
        if (count !== 1) {
            throw new Error("has an AC scan of " + count + " components");
        }
        if (to < from || to > 63) {
            throw new Error("has the spectral band from " + from + " to " + to);
        }
        return high === 0 ? "acFirst" : "acRefine";
    }

    private select(component: FrameComponent, from: number, to: number, high: number, low: number): void {
        if (!this.progressive) {
            if (component.dcLow !== -1) {
                throw new Error("has the component " + component.id + " in more than one scan");
            }
            component.dcLow = 0;
            return;
        }
        if (from > 0) {
            // ITU-T T.81 §G.1.1.1.1: "For each component, a first DC scan shall precede any AC scans."
            if (component.dcLow === -1) {
                throw new Error("has an AC scan of the component " + component.id + " before its first DC scan");
            }
            const band: ProgressiveBand | undefined = component.bands.find((item: ProgressiveBand): boolean => item.from === from && item.to === to);
            if (high === 0) {
                if (band !== undefined) {
                    throw new Error("has two first scans of the band " + from + " to " + to + " of the component " + component.id);
                }
                component.bands.push({ from, to, low });
                return;
            }
            if (band === undefined) {
                throw new Error("refines the band " + from + " to " + to + " of the component " + component.id + ", which no scan has coded first");
            }
            if (high !== band.low) {
                throw new Error("does not improve the band " + from + " to " + to + " of the component " + component.id + " by one bit");
            }
            band.low = low;
            return;
        }
        if (high === 0) {
            if (component.dcLow !== -1) {
                throw new Error("has two first DC scans of the component " + component.id);
            }
            component.dcLow = low;
            return;
        }
        if (component.dcLow === -1) {
            throw new Error("has a DC scan of the component " + component.id + " that no first DC scan precedes");
        }
        if (high !== component.dcLow) {
            throw new Error("does not improve the DC of the component " + component.id + " by one bit");
        }
        component.dcLow = low;
    }

    private expectRestart(expected: number): void {
        this.count = 0;
        const data: Buffer = this.data;
        while (this.position + 1 < data.length && data[this.position] === 0xFF && data[this.position + 1] === 0xFF) {
            this.position++;
        }
        if (this.position + 1 >= data.length || data[this.position] !== 0xFF || data[this.position + 1] !== 0xD0 + expected) {
            throw new Error("has no restart marker " + expected);
        }
        this.position += 2;
    }

    private mcu(scanComponents: ReadonlyArray<ScanComponent>, interleaved: boolean, x: number, y: number): void {
        if (!interleaved) {
            this.block(scanComponents[0], x, y);
            return;
        }
        for (const scanComponent of scanComponents) {
            const horizontal: number = scanComponent.component.horizontal;
            const vertical: number = scanComponent.component.vertical;
            // ITU-T T.81 §A.2.3: the MCU holds Hi by Vi data units of each component, ordered left-to-right and top-to-bottom.
            for (let down: number = 0; down < vertical; down++) {
                for (let across: number = 0; across < horizontal; across++) {
                    this.block(scanComponent, x * horizontal + across, y * vertical + down);
                }
            }
        }
    }

    private block(scanComponent: ScanComponent, across: number, down: number): void {
        const component: FrameComponent = scanComponent.component;
        const store: Int32Array | undefined = component.coefficients;
        if (store === undefined) {
            throw new Error("has the component " + component.id + " in no scan");
        }
        if (this.lossless) {
            if (this.arithmetic) {
                this.arithmeticLossless(scanComponent, store, across, down);
            } else {
                this.huffmanLossless(scanComponent, store, across, down);
            }
            return;
        }
        const offset: number = (down * component.blocksAcross + across) * 64;
        if (this.arithmetic) {
            this.arithmeticBlock(scanComponent, store, offset);
            return;
        }
        switch (this.scanKind) {
            case "sequential": {
                const dcTable: HuffmanTable | undefined = scanComponent.dcTable;
                const acTable: HuffmanTable | undefined = scanComponent.acTable;
                if (dcTable === undefined || acTable === undefined) {
                    throw new Error("has a scan of the component " + component.id + " without its tables");
                }
                const category: number = this.huffman(dcTable);
                // ITU-T T.81 §F.2.2.1: DIFF = EXTEND(RECEIVE(T), T) and the DC is the prediction plus the difference (§F.2.1.3.1);
                // ITU-T T.81 §J.2.3.1: a differential frame codes its DC without prediction.
                const difference: number = category === 0 ? 0 : this.extend(this.receive(category), category);
                scanComponent.pred = this.differential ? difference : scanComponent.pred + difference;
                store[offset] = scanComponent.pred;
                let k: number = 1;
                for (; ;) {
                    const symbol: number = this.huffman(acTable);
                    const size: number = symbol & 0x0F;
                    if (size === 0) {
                        if (symbol !== 0xF0) {
                            return;
                        }
                        k += 16;
                    } else {
                        k += symbol >> 4;
                        if (k > 63) {
                            throw new Error("has an AC coefficient at the zig-zag position " + k);
                        }
                        store[offset + ZIGZAG[k]] = this.extend(this.receive(size), size);
                        if (k === 63) {
                            return;
                        }
                        k++;
                    }
                }
            }
            case "dcFirst": {
                const dcTable: HuffmanTable | undefined = scanComponent.dcTable;
                if (dcTable === undefined) {
                    throw new Error("has a scan of the component " + component.id + " without its DC table");
                }
                const category: number = this.huffman(dcTable);
                const difference: number = category === 0 ? 0 : this.extend(this.receive(category), category);
                scanComponent.pred = this.differential ? difference : scanComponent.pred + difference;
                // ITU-T T.81 §A.4 and §G.1.2.1: the point transform of the DC is undone by shifting left by Al.
                store[offset] = scanComponent.pred << this.scanLow;
                return;
            }
            case "dcRefine":
                // ITU-T T.81 §G.1.2.1: the refinement is the least significant bit of the point transformed DC, bit Al of the value.
                if (this.bit()) {
                    store[offset] |= 1 << this.scanLow;
                }
                return;

            case "acFirst": {
                const acTable: HuffmanTable | undefined = scanComponent.acTable;
                if (acTable === undefined) {
                    throw new Error("has a scan of the component " + component.id + " without its AC table");
                }
                if (this.eobRun > 0) {
                    this.eobRun--;
                    return;
                }
                let k: number = this.scanFrom;
                while (k <= this.scanTo) {
                    const symbol: number = this.huffman(acTable);
                    const size: number = symbol & 0x0F;
                    if (size === 0) {
                        if (symbol !== 0xF0) {
                            // ITU-T T.81 Table G.1: EOBn adds n bits to the run 2^n, and the run counts this block too.
                            const run: number = symbol >> 4;
                            this.eobRun = (1 << run) + (run > 0 ? this.receive(run) : 0) - 1;
                            return;
                        }
                        k += 16;
                    } else {
                        k += symbol >> 4;
                        if (k > this.scanTo) {
                            throw new Error("has an AC coefficient beyond the band of its scan");
                        }
                        store[offset + ZIGZAG[k]] = this.extend(this.receive(size), size) << this.scanLow;
                        k++;
                    }
                }
                return;
            }
            default: {
                const acTable: HuffmanTable | undefined = scanComponent.acTable;
                if (acTable === undefined) {
                    throw new Error("has a scan of the component " + component.id + " without its AC table");
                }
                const place: number = 1 << this.scanLow;
                const remove: number = -place;
                if (this.eobRun > 0) {
                    this.eobRun--;
                    this.correct(store, offset, this.scanFrom, this.scanTo, place, remove);
                    return;
                }
                let k: number = this.scanFrom;
                while (k <= this.scanTo) {
                    const symbol: number = this.huffman(acTable);
                    const size: number = symbol & 0x0F;
                    if (size !== 0) {
                        if (size !== 1) {
                            throw new Error("has the magnitude category " + size + " in a refinement scan");
                        }
                        let run: number = symbol >> 4;
                        // ITU-T T.81 §G.1.2.3: the Huffman code is followed by the sign bit of the newly non-zero
                        // coefficient (rule a) and then by the correction bits of the coefficients the run passes (rule b).
                        const sign: number = this.bit();
                        while (k <= this.scanTo) {
                            const position: number = offset + ZIGZAG[k];
                            const value: number = store[position];
                            if (value === 0) {
                                run--;
                                if (run < 0) {
                                    break;
                                }
                            } else if (this.bit()) {
                                store[position] = value + (value < 0 ? remove : place);
                            }
                            k++;
                        }
                        if (k > this.scanTo) {
                            throw new Error("has a zero run beyond the band of its scan");
                        }
                        // ITU-T T.81 §G.1.2.3 rule a: a 1-bit signs the newly non-zero coefficient positive, a 0-bit negative.
                        store[offset + ZIGZAG[k]] = sign === 1 ? place : remove;
                        k++;
                    } else if (symbol !== 0xF0) {
                        const run: number = symbol >> 4;
                        this.eobRun = (1 << run) + (run > 0 ? this.receive(run) : 0) - 1;
                        this.correct(store, offset, k, this.scanTo, place, remove);
                        return;
                    } else {
                        let zeros: number = 16;
                        while (k <= this.scanTo && zeros > 0) {
                            const position: number = offset + ZIGZAG[k];
                            const value: number = store[position];
                            if (value === 0) {
                                zeros--;
                            } else if (this.bit()) {
                                store[position] = value + (value < 0 ? remove : place);
                            }
                            k++;
                        }
                    }
                }
            }
        }
    }

    private correct(store: Int32Array, offset: number, from: number, to: number, place: number, remove: number): void {
        // ITU-T T.81 §G.1.2.3 rule b: a 1-bit adds one to the scaled magnitude of each coefficient with a non-zero history.
        for (let k: number = from; k <= to; k++) {
            const position: number = offset + ZIGZAG[k];
            const value: number = store[position];
            if (value !== 0 && this.bit()) {
                store[position] = value + (value < 0 ? remove : place);
            }
        }
    }

    private huffmanLossless(scanComponent: ScanComponent, store: Int32Array, across: number, down: number): void {
        const dcTable: HuffmanTable | undefined = scanComponent.dcTable;
        if (dcTable === undefined) {
            throw new Error("has a scan of the component " + scanComponent.component.id + " without its DC table");
        }
        // ITU-T T.81 §H.1.2.2 and Table H.2: the DC procedures code the modulo difference; SSSS 16 is 32768 with no extra bits.
        const category: number = this.huffman(dcTable);
        const difference: number = category === 16 ? 32768 : (category === 0 ? 0 : this.extend(this.receive(category), category));
        this.losslessSample(scanComponent, store, across, down, difference);
    }

    private arithmeticLossless(scanComponent: ScanComponent, store: Int32Array, across: number, down: number): void {
        // ITU-T T.81 §H.1.2.3.1: the conditioning combines the difference to the left and the difference above, and Da is zero
        // at the start of each line.
        const above: number = scanComponent.aboveDifferences[across];
        const left: number = across === 0 ? 0 : scanComponent.leftDifference;
        const dbClass: number = this.differenceClass(above, scanComponent.dcU, scanComponent.dcL);
        const daClass: number = this.differenceClass(left, scanComponent.dcU, scanComponent.dcL);
        const s0: number = scanComponent.llBase + 4 * (5 * daClass + dbClass);
        let difference: number = 0;
        if (this.arithmeticDecode(s0) === 1) {
            // ITU-T T.81 Table H.3: SS is S0 + 1, SP and SN are S0 + 2 and S0 + 3, and X1 follows the class of Db.
            const negative: boolean = this.arithmeticDecode(s0 + 1) === 1;
            const x1: number = scanComponent.llBase + (dbClass <= 2 ? 100 : 129);
            const magnitude: number = this.arithmeticMagnitude(negative ? s0 + 3 : s0 + 2, x1, x1 + 1);
            difference = negative ? -magnitude : magnitude;
        }
        this.losslessSample(scanComponent, store, across, down, difference);
    }

    private losslessSample(scanComponent: ScanComponent, store: Int32Array, across: number, down: number, difference: number): void {
        // ITU-T T.81 §H.1.2.1: the difference is added, modulo 2^16, to the prediction; §H.1.2.3 keeps the row's conditioning.
        const prediction: number = this.predict(scanComponent, across, down);
        store[down * scanComponent.component.blocksAcross + across] = (prediction + difference) & 0xFFFF;
        scanComponent.leftDifference = difference;
        scanComponent.aboveDifferences[across] = difference;
    }

    private predict(scanComponent: ScanComponent, across: number, down: number): number {
        // ITU-T T.81 §J.1.3.2: a differential lossless frame codes its differences without prediction.
        if (this.scanFrom === 0) {
            return 0;
        }
        const store: Int32Array | undefined = scanComponent.component.coefficients;
        if (store === undefined) {
            throw new Error("has the component " + scanComponent.component.id + " in no scan");
        }
        const width: number = scanComponent.component.blocksAcross;
        const offset: number = down * width + across;
        if (down === scanComponent.intervalStartY) {
            if (across === 0) {
                // ITU-T T.81 §H.1.2.1: the interval starts from 2^(P-Pt-1); the rest of its first line predicts from Ra.
                return 1 << (this.precision - this.scanLow - 1);
            }
            return store[offset - 1];
        }
        if (across === 0) {
            return store[offset - width];
        }
        const left: number = store[offset - 1];
        const above: number = store[offset - width];
        const diagonal: number = store[offset - width - 1];
        // ITU-T T.81 Table H.1: the selected predictor, with the arithmetic right shifts of selections 5 and 6.
        switch (this.scanFrom) {
            case 1: return left;
            case 2: return above;
            case 3: return diagonal;
            case 4: return left + above - diagonal;
            case 5: return left + ((above - diagonal) >> 1);
            case 6: return above + ((left - diagonal) >> 1);
            default: return (left + above) >> 1;
        }
    }

    private conditioning(end: number): void {
        // ITU-T T.81 §B.2.4.3: a DC entry holds L + 16 * U for the bounds of Figure F.10, an AC entry the Kx of Table F.5.
        const data: Buffer = this.data;
        let at: number = this.position + 2;
        while (at + 1 < end) {
            const tableClass: number = data[at] >> 4;
            const destination: number = data[at] & 0x0F;
            const value: number = data[at + 1];
            at += 2;
            if (tableClass > 1 || destination > 3) {
                throw new Error("has the arithmetic conditioning class " + tableClass + " in the destination " + destination);
            }
            if (tableClass === 0) {
                const lower: number = value & 0x0F;
                const upper: number = value >> 4;
                if (lower > upper) {
                    throw new Error("has the DC conditioning L " + lower + " above U " + upper);
                }
                this.dcConditioning[destination] = [upper, lower];
            } else {
                if (value < 1 || value > 63) {
                    throw new Error("has the AC conditioning Kx " + value);
                }
                this.acConditioning[destination] = value;
            }
        }
        if (at !== end) {
            throw new Error("has a DAC segment with unused bytes");
        }
    }

    private arithmeticInit(): void {
        // ITU-T T.81 Figure D.22: the statistics start at MPS 0 and Qe index 0 (§D.2.7); A is X'10000' and two bytes fill Cx.
        this.arithmeticState.fill(0);
        this.stalled = false;
        this.interval = 0x10000;
        this.code = 0;
        this.byteIn();
        this.code = this.code << 8;
        this.byteIn();
        this.code = this.code << 8;
        this.codeCount = 0;
    }

    private arithmeticDecode(context: number): number {
        // ITU-T T.81 Figure D.16 with the conditional exchanges of Figures D.17 and D.18; Table D.3 gives Qe and the next states.
        const state: number = this.arithmeticState[context];
        const index: number = state & 0x7F;
        const mps: number = state >> 7;
        const qe: number = QE[index];
        this.interval -= qe;
        // ITU-T T.81 §D.2.3: the decoding comparisons use Cx alone, as an unsigned value.
        if ((this.code >>> 16) < this.interval) {
            if (this.interval < 0x8000) {
                if (this.interval < qe) {
                    this.arithmeticState[context] = NEXT_LPS[index] | ((EXCHANGE[index] !== 0 ? 1 - mps : mps) << 7);
                    const decision: number = 1 - mps;
                    this.arithmeticRenorm();
                    return decision;
                }
                this.arithmeticState[context] = NEXT_MPS[index] | (mps << 7);
                this.arithmeticRenorm();
                return mps;
            }
            return mps;
        }
        // ITU-T T.81 Figure D.17: the LPS path subtracts A from Cx in both of its cases and sets A to Qe.
        this.code -= this.interval << 16;
        const exchanged: boolean = this.interval < qe;
        this.interval = qe;
        if (exchanged) {
            this.arithmeticState[context] = NEXT_MPS[index] | (mps << 7);
            this.arithmeticRenorm();
            return mps;
        }
        this.arithmeticState[context] = NEXT_LPS[index] | ((EXCHANGE[index] !== 0 ? 1 - mps : mps) << 7);
        this.arithmeticRenorm();
        return 1 - mps;
    }

    private fixedDecision(): number {
        // ITU-T T.81 §F.1.4.4.2 and §G.1.3.1: the sign and DC refinement decisions use the fixed estimate Qe = X'5A1D', MPS 0.
        this.interval -= FIXED_INTERVAL;
        // ITU-T T.81 §D.2.3: the decoding comparisons use Cx alone, as an unsigned value.
        if ((this.code >>> 16) < this.interval) {
            if (this.interval >= 0x8000) {
                return 0;
            }
            // ITU-T T.81 Figure D.18: when A is below Qe after an MPS renormalization, the sense of the decision is inverted.
            const inverted: number = this.interval < FIXED_INTERVAL ? 1 : 0;
            this.arithmeticRenorm();
            return inverted;
        }
        // ITU-T T.81 Figure D.17: when A is below Qe on the LPS path, the decision is the MPS.
        const exchanged: boolean = this.interval < FIXED_INTERVAL;
        this.code -= this.interval << 16;
        this.interval = FIXED_INTERVAL;
        this.arithmeticRenorm();
        return exchanged ? 0 : 1;
    }

    private arithmeticRenorm(): void {
        // ITU-T T.81 Figure D.19: both registers shift until A reaches X'8000', drawing a byte whenever CT runs out.
        do {
            if (this.codeCount === 0) {
                this.byteIn();
                this.codeCount = 8;
            }
            this.interval <<= 1;
            this.code <<= 1;
            this.codeCount--;
        } while (this.interval < 0x8000);
    }

    private byteIn(): void {
        // ITU-T T.81 Figures D.20 and D.21: an X'FF' is followed by a stuffed zero; a marker stops the decoding (Adjust BP).
        const data: Buffer = this.data;
        if (this.stalled) {
            return;
        }
        if (this.position >= data.length) {
            this.stalled = true;
            return;
        }
        const first: number = data[this.position];
        this.position++;
        if (first !== 0xFF) {
            this.code += first << 8;
            return;
        }
        if (this.position >= data.length) {
            this.code += 0xFF00;
            this.stalled = true;
            return;
        }
        const second: number = data[this.position];
        if (second !== 0x00) {
            this.position--;
            this.stalled = true;
            return;
        }
        this.position++;
        this.code += 0xFF00;
    }

    private differenceClass(difference: number, upper: number, lower: number): number {
        // ITU-T T.81 §F.1.4.4.1.2: the lower bound (exclusive) of a small difference is 2^(L-1), or zero for L = 0, and the
        // upper bound (inclusive) is 2^U.
        if (difference === 0) {
            return 0;
        }
        const magnitude: number = difference < 0 ? -difference : difference;
        if (lower > 0 && magnitude <= 1 << (lower - 1)) {
            return 0;
        }
        const small: boolean = magnitude <= 1 << upper;
        if (difference > 0) {
            return small ? 1 : 3;
        }
        return small ? 2 : 4;
    }

    private dcContext(scanComponent: ScanComponent): number {
        // ITU-T T.81 §F.1.4.4.1.2: S0 is 0, 4, 8, 12 or 16 by the class of the previous difference.
        return 4 * this.differenceClass(scanComponent.lastDifference, scanComponent.dcU, scanComponent.dcL);
    }

    private arithmeticMagnitude(start: number, first: number, second: number): number {
        // ITU-T T.81 Figures F.23 and F.24: the category grows the bound until a 0-decision, then the low order bits follow MSB first.
        let bound: number = 1;
        let context: number = start;
        for (; ;) {
            if (this.arithmeticDecode(context) === 0) {
                break;
            }
            if (bound === 1) {
                bound = 2;
                context = first;
            } else if (bound === 2) {
                bound = 4;
                context = second;
            } else {
                bound <<= 1;
                context++;
            }
            if (bound > 32768) {
                throw new Error("has a magnitude beyond the precision of the DCT");
            }
        }
        context += 14;
        // ITU-T T.81 Figure F.23: the leading 1 bit of Sz is assigned as M SRL 1, not coded; Figure F.24 and Table F.3
        // add only the log2(M) - 1 low order bits below it.
        let value: number = bound >> 1;
        let mask: number = value >> 1;
        while (mask > 0) {
            if (this.arithmeticDecode(context) === 1) {
                // ITU-T T.81 Figure F.24: Sz = M OR Sz.
                value |= mask;
            }
            mask >>= 1;
        }
        return value + 1;
    }

    private arithmeticBlock(scanComponent: ScanComponent, store: Int32Array, offset: number): void {
        switch (this.scanKind) {
            case "sequential":
            case "dcFirst": {
                const s0: number = scanComponent.dcBase + this.dcContext(scanComponent);
                let difference: number = 0;
                if (this.arithmeticDecode(s0) === 1) {
                    // ITU-T T.81 Figure F.22: a 1-decision signs the value negative; Figures F.23 and F.24 decode Sz, which gains 1.
                    const negative: boolean = this.arithmeticDecode(s0 + 1) === 1;
                    const magnitude: number = this.arithmeticMagnitude(negative ? s0 + 3 : s0 + 2, scanComponent.dcBase + 20, scanComponent.dcBase + 21);
                    difference = negative ? -magnitude : magnitude;
                }
                scanComponent.lastDifference = difference;
                // ITU-T T.81 §F.2.1.3.1: the DC is the prediction plus the difference; §J.2.3.1 codes it without prediction.
                scanComponent.pred = this.differential ? difference : scanComponent.pred + difference;
                // ITU-T T.81 §A.4 and §G.1.3.1: the point transform of the DC is undone by shifting left by Al.
                store[offset] = scanComponent.pred << this.scanLow;
                if (this.scanKind === "dcFirst") {
                    return;
                }
                this.arithmeticAc(scanComponent, store, offset, 1, 63);
                return;
            }
            case "dcRefine":
                // ITU-T T.81 §G.1.3.1: the refinement is one binary decision with the fixed estimate, bit Al of the DC.
                if (this.fixedDecision() === 1) {
                    store[offset] |= 1 << this.scanLow;
                }
                return;
            case "acFirst":
                this.arithmeticAc(scanComponent, store, offset, this.scanFrom, this.scanTo);
                return;
            default:
                this.arithmeticRefine(scanComponent, store, offset);
        }
    }

    private arithmeticAc(scanComponent: ScanComponent, store: Int32Array, offset: number, from: number, to: number): void {
        // ITU-T T.81 Figure F.20: an EOB decision opens each position that a non-zero coefficient can follow.
        let k: number = from;
        while (k <= to) {
            if (this.arithmeticDecode(scanComponent.acBase + 3 * (k - 1)) === 1) {
                return;
            }
            for (; ;) {
                if (this.arithmeticDecode(scanComponent.acBase + 3 * (k - 1) + 1) === 1) {
                    // ITU-T T.81 Table F.5: the sign uses the fixed estimate; X2 is 189 when K is at most Kx and 217 past it.
                    const negative: boolean = this.fixedDecision() === 1;
                    // ITU-T T.81 Table F.5: the first two magnitude category decisions use the SN/SP bin at S0 + 1.
                    const start: number = scanComponent.acBase + 3 * (k - 1) + 2;
                    const magnitude: number = this.arithmeticMagnitude(start, start, scanComponent.acBase + (k <= scanComponent.acKx ? 189 : 217));
                    store[offset + ZIGZAG[k]] = (negative ? -magnitude : magnitude) << this.scanLow;
                    break;
                }
                k++;
                if (k > to) {
                    throw new Error("has a zero run beyond the band of its scan");
                }
            }
            if (k === to) {
                return;
            }
            k++;
        }
    }

    private arithmeticRefine(scanComponent: ScanComponent, store: Int32Array, offset: number): void {
        // ITU-T T.81 §G.1.3.3: the EOB decision is skipped before EOBx, the position after the last non-zero coefficient of the band.
        let eobx: number = this.scanFrom;
        for (let k: number = this.scanTo; k >= this.scanFrom; k--) {
            if (store[offset + ZIGZAG[k]] !== 0) {
                eobx = k + 1;
                break;
            }
        }
        let k: number = this.scanFrom;
        while (k <= this.scanTo) {
            if (k >= eobx && this.arithmeticDecode(scanComponent.acBase + 3 * (k - 1)) === 1) {
                return;
            }
            const position: number = offset + ZIGZAG[k];
            const value: number = store[position];
            if (value === 0) {
                // ITU-T T.81 Figure G.11: a zero history coefficient becomes non-zero when S0 says so; its sign uses the fixed estimate.
                if (this.arithmeticDecode(scanComponent.acBase + 3 * (k - 1) + 1) === 1) {
                    store[position] = this.fixedDecision() === 1 ? -(1 << this.scanLow) : 1 << this.scanLow;
                }
            } else if (this.arithmeticDecode(scanComponent.acBase + 3 * (k - 1) + 2) === 1) {
                // ITU-T T.81 Figure G.11: the correction decision SC adds one to the scaled magnitude.
                store[position] = value + (value < 0 ? -(1 << this.scanLow) : 1 << this.scanLow);
            }
            if (k === this.scanTo) {
                return;
            }
            k++;
        }
    }

    private huffman(table: HuffmanTable): number {
        // ITU-T T.81 §F.16: the code grows one bit at a time until it is not above MAXCODE; a length with no codes keeps MAXCODE -1.
        let code: number = this.bit();
        let length: number = 1;
        while (code > table.maxCode[length - 1]) {
            if (length === 16) {
                throw new Error("holds a Huffman code that belongs to no table");
            }
            length++;
            code = (code << 1) | this.bit();
        }
        return table.values[table.valuePtr[length - 1] + code - table.minCode[length - 1]];
    }

    private receive(bits: number): number {
        // ITU-T T.81 §F.2.2.4: the bits of the appended value arrive MSB first (§C.3).
        let value: number = 0;
        for (let index: number = 0; index < bits; index++) {
            value = (value << 1) | this.bit();
        }
        return value;
    }

    private extend(value: number, bits: number): number {
        // ITU-T T.81 §F.12: a decoded value below half the range of its precision is negative.
        return value < (1 << (bits - 1)) ? value - (1 << bits) + 1 : value;
    }

    private bit(): number {
        if (this.count === 0) {
            this.byte = this.byteOfData();
            this.count = 8;
        }
        this.count--;
        return (this.byte >> this.count) & 1;
    }

    private byteOfData(): number {
        const data: Buffer = this.data;
        if (this.huffmanStalled) {
            return 0xFF;
        }
        if (this.position >= data.length) {
            throw new Error("ends before its entropy-coded data does");
        }
        const value: number = data[this.position];
        this.position++;
        if (value !== 0xFF) {
            return value;
        }
        // ITU-T T.81 §B.1.1.5: an X'FF' of the entropy-coded data is followed by a stuffed zero byte; any other byte is a marker.
        if (this.position >= data.length || data[this.position] !== 0x00) {
            if (this.pendingLines) {
                // ITU-T T.81 §B.2.5: the marker ends the first scan, and the DNL segment after it gives the number of lines.
                this.position--;
                this.huffmanStalled = true;
                return 0xFF;
            }
            throw new Error("holds a marker inside its entropy-coded data");
        }
        this.position++;
        return 0xFF;
    }

    private inverse(store: Int32Array, blockOffset: number, quant: Uint16Array, plane: Int32Array, planeWidth: number, across: number, down: number): void {
        const cosines: Float64Array = JpegDecoder.COSINES;
        const rows: Float64Array = this.rows;
        for (let row: number = 0; row < 64; row += 8) {
            for (let x: number = 0; x < 8; x++) {
                let sum: number = 0;
                for (let u: number = 0; u < 8; u++) {
                    const coefficient: number = store[blockOffset + row + u];
                    if (coefficient !== 0) {
                        // ITU-T T.81 §A.3.4: dequantization multiplies each coefficient by its table entry on the way into the IDCT.
                        sum += cosines[u * 8 + x] * coefficient * quant[row + u];
                    }
                }
                rows[row + x] = sum;
            }
        }
        const offset: number = down * 8 * planeWidth + across * 8;
        const limit: number = 1 << this.precision;
        for (let y: number = 0; y < 8; y++) {
            for (let x: number = 0; x < 8; x++) {
                let sum: number = 0;
                for (let v: number = 0; v < 8; v++) {
                    sum += cosines[v * 8 + y] * rows[v * 8 + x];
                }
                if (this.differential) {
                    // ITU-T T.81 §J.2.3.1: the IDCT of the differential output is calculated without the level shift.
                    plane[offset + y * planeWidth + x] = Math.round(sum);
                } else {
                    // ITU-T T.81 §A.3.1: the level shift is +2^(P-1); §F.2.1.5: the sample is clamped to the range 0 to 2^P-1.
                    const shifted: number = sum + (1 << (this.precision - 1)) + 0.5;
                    plane[offset + y * planeWidth + x] = shifted <= 0 ? 0 : shifted >= limit ? limit - 1 : shifted;
                }
            }
        }
    }

    private losslessPlane(component: FrameComponent): ImagePlane {
        // ITU-T T.81 §H.2.2: the decoder interprets the point transform parameter and multiplies its output by 2^Pt (§A.4).
        const width: number = component.blocksAcross;
        const height: number = component.blocksDown;
        const store: Int32Array | undefined = component.coefficients;
        if (store === undefined) {
            throw new Error("has the component " + component.id + " in no scan");
        }
        const plane: Int32Array = new Int32Array(width * height);
        const shift: number = component.pointTransform;
        for (let index: number = 0; index < plane.length; index++) {
            plane[index] = (store[index] << shift) & 0xFFFF;
        }
        return { plane, width, height };
    }

    private transformPlane(component: FrameComponent): ImagePlane {
        const store: Int32Array | undefined = component.coefficients;
        if (store === undefined) {
            throw new Error("has the component " + component.id + " in no scan");
        }
        const quant: Uint16Array | undefined = this.quantization[component.quantization];
        if (quant === undefined) {
            throw new Error("has the component " + component.id + " without its quantization table");
        }
        component.planeWidth = component.blocksAcross * 8;
        const plane: Int32Array = new Int32Array(component.planeWidth * component.blocksDown * 8);
        for (let down: number = 0; down < component.blocksDown; down++) {
            for (let across: number = 0; across < component.blocksAcross; across++) {
                this.inverse(store, (down * component.blocksAcross + across) * 64, quant, plane, component.planeWidth, across, down);
            }
        }
        return { plane, width: component.planeWidth, height: component.blocksDown * 8 };
    }

    private assemble(): JpegSamples {
        if (this.pendingLines) {
            throw new Error("defines its number of lines with a DNL segment, which never arrives");
        }
        const outputs: Array<OutputPlane> = [];
        let width: number;
        let height: number;
        let bits: number;
        if (this.hierarchical) {
            // ITU-T T.81 §J.2.1: the image is the set of reference components after the last frame, sized by the DHP segment.
            this.finishFrame();
            width = this.dhpWidth;
            height = this.dhpHeight;
            bits = this.dhpPrecision;
            for (const component of this.dhpComponents) {
                const reference: ImagePlane | undefined = this.references.get(component.id);
                if (reference === undefined) {
                    throw new Error("has no reference component " + component.id);
                }
                outputs.push({
                    id: component.id, plane: reference.plane, width: reference.width,
                    horizontal: component.horizontal, vertical: component.vertical
                });
            }
        } else {
            if (!this.frameParsed) {
                throw new Error("holds no frame");
            }
            width = this.width;
            height = this.height;
            bits = this.precision;
            for (const component of this.components) {
                const store: Int32Array | undefined = component.coefficients;
                if (store === undefined || component.dcLow === -1) {
                    throw new Error("has the component " + component.id + " in no scan");
                }
                const plane: ImagePlane = this.lossless ? this.losslessPlane(component) : this.transformPlane(component);
                outputs.push({
                    id: component.id, plane: plane.plane, width: plane.width,
                    horizontal: component.horizontal, vertical: component.vertical
                });
            }
        }
        const count: number = outputs.length;
        const colorSpace: "gray" | "rgb" | "cmyk" | "multi" = count === 1 ? "gray" : (count === 3 ? "rgb" : (count === 4 ? "cmyk" : "multi"));
        const horizontalMax: number = outputs.reduce((max: number, output: OutputPlane): number => Math.max(max, output.horizontal), 1);
        const verticalMax: number = outputs.reduce((max: number, output: OutputPlane): number => Math.max(max, output.vertical), 1);
        const pixels: Uint16Array = new Uint16Array(width * height * count);
        const columns: Array<Uint32Array> = outputs.map((output: OutputPlane): Uint32Array => {
            const map: Uint32Array = new Uint32Array(width);
            for (let x: number = 0; x < width; x++) {
                // JFIF: the samples of a subsampled component are cosited with those of the largest one.
                map[x] = Math.floor(x * output.horizontal / horizontalMax);
            }
            return map;
        });
        let target: number = 0;
        if (count === 3) {
            target = this.rgbSample(pixels, target, outputs, columns, width, height, verticalMax);
        } else if (count === 4) {
            target = this.cmykSample(pixels, target, outputs, columns, width, height, verticalMax);
        } else {
            target = this.copySample(pixels, target, outputs, columns, width, height, verticalMax);
        }
        return { width, height, components: count, bits, colorSpace, pixels };
    }

    private rgbSample(pixels: Uint16Array, target: number, outputs: ReadonlyArray<OutputPlane>, columns: ReadonlyArray<Uint32Array>,
        width: number, height: number, verticalMax: number): number {
        const direct: boolean = this.adobeTransform === 0 || (this.adobeTransform === undefined
            && outputs[0].id === RED && outputs[1].id === GREEN && outputs[2].id === BLUE);
        const scale: number = 1 << (this.outputBits() - 8);
        const mid: number = 1 << (this.outputBits() - 1);
        for (let line: number = 0; line < height; line++) {
            const rows: Array<number> = outputs.map((output: OutputPlane): number => Math.floor(line * output.vertical / verticalMax) * output.width);
            for (let x: number = 0; x < width; x++) {
                const first: number = outputs[0].plane[rows[0] + columns[0][x]];
                const second: number = outputs[1].plane[rows[1] + columns[1][x]];
                const third: number = outputs[2].plane[rows[2] + columns[2][x]];
                if (direct) {
                    pixels[target++] = first;
                    pixels[target++] = second;
                    pixels[target++] = third;
                } else {
                    // JFIF, "YCbCr to RGB Conversion": R = Y + 1.402 (Cr - 128), G = Y - 0.34414 (Cb - 128)
                    // - 0.71414 (Cr - 128), B = Y + 1.772 (Cb - 128); the midpoint and the scale follow the precision.
                    const cb: number = second - mid;
                    const cr: number = third - mid;
                    pixels[target++] = this.channel(first + 1.402 * scale * cr);
                    pixels[target++] = this.channel(first - 0.34414 * scale * cb - 0.71414 * scale * cr);
                    pixels[target++] = this.channel(first + 1.772 * scale * cb);
                }
            }
        }
        return target;
    }

    private cmykSample(pixels: Uint16Array, target: number, outputs: ReadonlyArray<OutputPlane>, columns: ReadonlyArray<Uint32Array>,
        width: number, height: number, verticalMax: number): number {
        // ISO 32000-2 §7.4.8: Adobe applications write the inks of a CMYK JPEG inverted, which their APP14 segment marks;
        // a YCCK file carries CMY through the YCbCr transform of JFIF before that inversion.
        const inverted: boolean = this.adobeTransform !== undefined;
        const transformed: boolean = this.adobeTransform === 2;
        const full: number = (1 << this.outputBits()) - 1;
        const scale: number = 1 << (this.outputBits() - 8);
        const mid: number = 1 << (this.outputBits() - 1);
        for (let line: number = 0; line < height; line++) {
            const rows: Array<number> = outputs.map((output: OutputPlane): number => Math.floor(line * output.vertical / verticalMax) * output.width);
            for (let x: number = 0; x < width; x++) {
                let first: number = outputs[0].plane[rows[0] + columns[0][x]];
                let second: number = outputs[1].plane[rows[1] + columns[1][x]];
                let third: number = outputs[2].plane[rows[2] + columns[2][x]];
                const fourth: number = outputs[3].plane[rows[3] + columns[3][x]];
                if (transformed) {
                    const luma: number = first;
                    const cb: number = second - mid;
                    const cr: number = third - mid;
                    first = this.channel(luma + 1.402 * scale * cr);
                    second = this.channel(luma - 0.34414 * scale * cb - 0.71414 * scale * cr);
                    third = this.channel(luma + 1.772 * scale * cb);
                }
                if (inverted) {
                    pixels[target++] = full - first;
                    pixels[target++] = full - second;
                    pixels[target++] = full - third;
                    pixels[target++] = full - fourth;
                } else {
                    pixels[target++] = first;
                    pixels[target++] = second;
                    pixels[target++] = third;
                    pixels[target++] = fourth;
                }
            }
        }
        return target;
    }

    private copySample(pixels: Uint16Array, target: number, outputs: ReadonlyArray<OutputPlane>, columns: ReadonlyArray<Uint32Array>,
        width: number, height: number, verticalMax: number): number {
        const count: number = outputs.length;
        for (let line: number = 0; line < height; line++) {
            const rows: Array<number> = outputs.map((output: OutputPlane): number => Math.floor(line * output.vertical / verticalMax) * output.width);
            for (let x: number = 0; x < width; x++) {
                for (let index: number = 0; index < count; index++) {
                    pixels[target++] = outputs[index].plane[rows[index] + columns[index][x]];
                }
            }
        }
        return target;
    }

    private channel(value: number): number {
        // The transform of JFIF lands outside the sample range only by rounding error; the added 1/2 and the
        // truncating store round it.
        const limit: number = 1 << this.outputBits();
        const rounded: number = value + 0.5;
        return rounded <= 0 ? 0 : rounded >= limit ? limit - 1 : rounded;
    }

    private outputBits(): number {
        return this.hierarchical ? this.dhpPrecision : this.precision;
    }

    private static readonly COSINES: Float64Array = JpegDecoder.cosines();

    private static cosines(): Float64Array {
        // ITU-T T.81 §A.3.3: the IDCT is the sum over u and v of C(u) C(v) S(v,u) cos cos with a 1/4 factor; each pass below carries 1/2.
        const table: Float64Array = new Float64Array(64);
        for (let frequency: number = 0; frequency < 8; frequency++) {
            const scale: number = (frequency === 0 ? Math.SQRT1_2 : 1) * 0.5;
            for (let sample: number = 0; sample < 8; sample++) {
                table[frequency * 8 + sample] = scale * Math.cos((2 * sample + 1) * frequency * Math.PI / 16);
            }
        }
        return table;
    }
}

