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

export interface LosslessImage {
    width: number;
    height: number;
    pixels: Uint32Array;
}

interface PrefixCode {
    single: number;
    counts: Uint16Array;
    symbols: Uint16Array;
}

interface Transform {
    type: number;
    width: number;
    bits: number;
    data: Uint32Array;
}

const SIGNATURE: number = 0x2F;
const PREDICTOR: number = 0;
const CROSS_COLOR: number = 1;
const SUBTRACT_GREEN: number = 2;
const COLOR_INDEXING: number = 3;
const LITERALS: number = 256;
const LENGTH_CODES: number = 24;
const DISTANCE_CODES: number = 40;
const MAXIMUM_LENGTH: number = 15;
const CACHE_MULTIPLIER: number = 0x1E35A7BD;
const CODE_LENGTH_ORDER: ReadonlyArray<number> = [17, 18, 0, 1, 2, 3, 4, 5, 16, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const DISTANCE_MAP: ReadonlyArray<number> = [
    0, 1, 1, 0, 1, 1, -1, 1, 0, 2, 2, 0, 1, 2, -1, 2, 2, 1, -2, 1, 2, 2, -2, 2, 0, 3, 3, 0, 1, 3, -1, 3, 3, 1, -3, 1, 2, 3, -2, 3, 3, 2, -3, 2, 0, 4, 4, 0,
    1, 4, -1, 4, 4, 1, -4, 1, 3, 3, -3, 3, 2, 4, -2, 4, 4, 2, -4, 2, 0, 5, 3, 4, -3, 4, 4, 3, -4, 3, 5, 0, 1, 5, -1, 5, 5, 1, -5, 1, 2, 5, -2, 5, 5, 2,
    -5, 2, 4, 4, -4, 4, 3, 5, -3, 5, 5, 3, -5, 3, 0, 6, 6, 0, 1, 6, -1, 6, 6, 1, -6, 1, 2, 6, -2, 6, 6, 2, -6, 2, 4, 5, -4, 5, 5, 4, -5, 4, 3, 6, -3, 6,
    6, 3, -6, 3, 0, 7, 7, 0, 1, 7, -1, 7, 5, 5, -5, 5, 7, 1, -7, 1, 4, 6, -4, 6, 6, 4, -6, 4, 2, 7, -2, 7, 7, 2, -7, 2, 3, 7, -3, 7, 7, 3, -7, 3, 5, 6,
    -5, 6, 6, 5, -6, 5, 8, 0, 4, 7, -4, 7, 7, 4, -7, 4, 8, 1, 8, 2, 6, 6, -6, 6, 8, 3, 5, 7, -5, 7, 7, 5, -7, 5, 8, 4, 6, 7, -6, 7, 7, 6, -7, 6, 8, 5,
    7, 7, -7, 7, 8, 6, 8, 7
];

export class Vp8lDecoder {

    private data: Buffer = Buffer.alloc(0);
    private position: number = 0;
    private bits: number = 0;
    private count: number = 0;

    image(data: Buffer): LosslessImage {
        // RFC 9649 §3.4: the signature byte, the width and height less one in 14 bits each, whether alpha is used, which "is a
        // hint only and SHOULD NOT impact decoding", and a version that must be 0.
        this.start(data);
        if (this.read(8) !== SIGNATURE) {
            throw new Error("The VP8L bitstream has no signature");
        }
        const width: number = this.read(14) + 1;
        const height: number = this.read(14) + 1;
        this.read(1);
        if (this.read(3) !== 0) {
            throw new Error("The VP8L bitstream has an unknown version");
        }
        return { width, height, pixels: this.stream(width, height) };
    }

    stream(width: number, height: number, data?: Buffer): Uint32Array {
        // §3.8.2: the transforms come first, each at most once, then the spatially coded image, and the transforms are
        // undone in the reverse order; §3.5.4: after color indexing the image that follows is bundled to fewer columns.
        if (data !== undefined) {
            this.start(data);
        }
        const transforms: Array<Transform> = [];
        let columns: number = width;
        while (this.read(1) === 1) {
            const type: number = this.read(2);
            if (transforms.some((transform: Transform) => transform.type === type)) {
                throw new Error("The VP8L bitstream repeats a transform");
            }
            const transform: Transform = { type, width: columns, bits: 0, data: new Uint32Array(0) };
            if (type === PREDICTOR || type === CROSS_COLOR) {
                transform.bits = this.read(3) + 2;
                transform.data = this.coded(this.divided(columns, transform.bits), this.divided(height, transform.bits), false);
            } else if (type === COLOR_INDEXING) {
                const size: number = this.read(8) + 1;
                transform.bits = size > 16 ? 0 : (size > 4 ? 1 : (size > 2 ? 2 : 3));
                transform.data = this.coded(size, 1, false);
                for (let index: number = 1; index < size; index++) {
                    transform.data[index] = this.added(transform.data[index], transform.data[index - 1]);
                }
                columns = this.divided(columns, transform.bits);
            }
            transforms.push(transform);
        }
        let pixels: Uint32Array = this.coded(columns, height, true);
        for (let index: number = transforms.length - 1; index >= 0; index--) {
            pixels = this.undone(transforms[index], pixels, height);
        }
        return pixels;
    }

    private start(data: Buffer): void {
        this.data = data;
        this.position = 0;
        this.bits = 0;
        this.count = 0;
    }

    private read(length: number): number {
        // §3.3: values are read from the least significant bit of each byte first.
        while (this.count < length) {
            if (this.position >= this.data.length + 4) {
                throw new Error("The VP8L bitstream ends early");
            }
            this.bits |= (this.data[this.position++] ?? 0) << this.count;
            this.count += 8;
        }
        const value: number = this.bits & ((1 << length) - 1);
        this.bits >>>= length;
        this.count -= length;
        return value;
    }

    private divided(size: number, bits: number): number {
        return (size + (1 << bits) - 1) >> bits;
    }

    private coded(width: number, height: number, top: boolean): Uint32Array {
        // §3.8.3: the color cache, the meta prefix codes of the ARGB image, the prefix code groups, then the pixels.
        let cacheBits: number = 0;
        if (this.read(1) === 1) {
            cacheBits = this.read(4);
            if (cacheBits < 1 || cacheBits > 11) {
                throw new Error("The VP8L bitstream has a color cache of " + cacheBits + " bits");
            }
        }
        let entropy: Uint32Array | undefined;
        let prefixBits: number = 0;
        let groupCount: number = 1;
        if (top && this.read(1) === 1) {
            prefixBits = this.read(3) + 2;
            entropy = this.coded(this.divided(width, prefixBits), this.divided(height, prefixBits), false);
            for (const value of entropy) {
                groupCount = Math.max(groupCount, ((value >> 8) & 0xFFFF) + 1);
            }
        }
        const cacheSize: number = cacheBits === 0 ? 0 : 1 << cacheBits;
        const alphabets: ReadonlyArray<number> = [LITERALS + LENGTH_CODES + cacheSize, LITERALS, LITERALS, LITERALS, DISTANCE_CODES];
        const groups: Array<ReadonlyArray<PrefixCode>> = [];
        for (let group: number = 0; group < groupCount; group++) {
            groups.push(alphabets.map((size: number) => this.prefixCode(size)));
        }
        return this.pixels(width, height, groups, entropy, prefixBits, cacheBits);
    }

    private pixels(width: number, height: number, groups: ReadonlyArray<ReadonlyArray<PrefixCode>>, entropy: Uint32Array | undefined, prefixBits: number,
        cacheBits: number): Uint32Array {
        // §3.7.2.3 and §3.6.2.3: a literal, a backward reference or a color cache index; every pixel produced goes into
        // the cache in the order of the stream.
        const total: number = width * height;
        const pixels: Uint32Array = new Uint32Array(total);
        const cache: Uint32Array | undefined = cacheBits === 0 ? undefined : new Uint32Array(1 << cacheBits);
        const entropyWidth: number = this.divided(width, prefixBits);
        let index: number = 0;
        let cached: number = 0;
        while (index < total) {
            const x: number = index % width;
            const y: number = (index - x) / width;
            const group: ReadonlyArray<PrefixCode> = entropy === undefined ? groups[0] : groups[(entropy[(y >> prefixBits) * entropyWidth + (x >> prefixBits)] >> 8) & 0xFFFF];
            const symbol: number = this.symbol(group[0]);
            if (symbol < LITERALS) {
                const red: number = this.symbol(group[1]);
                const blue: number = this.symbol(group[2]);
                const alpha: number = this.symbol(group[3]);
                pixels[index++] = ((alpha << 24) | (red << 16) | (symbol << 8) | blue) >>> 0;
            } else if (symbol < LITERALS + LENGTH_CODES) {
                const length: number = this.prefixValue(symbol - LITERALS);
                const distance: number = this.distance(this.prefixValue(this.symbol(group[4])), width);
                if (distance > index) {
                    throw new Error("A VP8L backward reference goes before the image");
                }
                for (let copied: number = 0; copied < length && index < total; copied++, index++) {
                    pixels[index] = pixels[index - distance];
                }
            } else if (cache !== undefined) {
                while (cached < index) {
                    cache[Math.imul(CACHE_MULTIPLIER, pixels[cached]) >>> (32 - cacheBits)] = pixels[cached];
                    cached++;
                }
                pixels[index++] = cache[symbol - LITERALS - LENGTH_CODES];
            } else {
                throw new Error("A VP8L color cache code without a color cache");
            }
        }
        return pixels;
    }

    private prefixValue(prefix: number): number {
        // §3.6.2.2: the value of a length or distance from its prefix code and its extra bits.
        if (prefix < 4) {
            return prefix + 1;
        }
        const extra: number = (prefix - 2) >> 1;
        return ((2 + (prefix & 1)) << extra) + this.read(extra) + 1;
    }

    private distance(code: number, width: number): number {
        // §3.6.2.2.1: codes above 120 are distances in scan-line order, offset by 120; the others are neighbours.
        if (code > 120) {
            return code - 120;
        }
        const distance: number = DISTANCE_MAP[(code - 1) * 2] + DISTANCE_MAP[(code - 1) * 2 + 1] * width;
        return distance < 1 ? 1 : distance;
    }

    private prefixCode(alphabet: number): PrefixCode {
        // §3.7.2.1: a simple code of one or two symbols, or code lengths coded with a code of their own.
        const lengths: Uint8Array = new Uint8Array(alphabet);
        if (this.read(1) === 1) {
            const symbols: number = this.read(1) + 1;
            const first: number = this.read(this.read(1) === 1 ? 8 : 1);
            this.mark(lengths, first, alphabet);
            if (symbols === 2) {
                this.mark(lengths, this.read(8), alphabet);
            }
            return this.built(lengths);
        }
        const lengthLengths: Uint8Array = new Uint8Array(CODE_LENGTH_ORDER.length);
        const used: number = 4 + this.read(4);
        for (let index: number = 0; index < used; index++) {
            lengthLengths[CODE_LENGTH_ORDER[index]] = this.read(3);
        }
        const lengthCode: PrefixCode = this.built(lengthLengths);
        let remaining: number = alphabet;
        if (this.read(1) === 1) {
            remaining = 2 + this.read(2 + 2 * this.read(3));
            if (remaining > alphabet) {
                throw new Error("A VP8L prefix code reads more lengths than its alphabet has");
            }
        }
        let previous: number = 8;
        for (let symbol: number = 0; symbol < alphabet && remaining-- > 0;) {
            const length: number = this.symbol(lengthCode);
            if (length < 16) {
                lengths[symbol++] = length;
                previous = length === 0 ? previous : length;
                continue;
            }
            const repeat: number = length === 16 ? 3 + this.read(2) : (length === 17 ? 3 + this.read(3) : 11 + this.read(7));
            if (symbol + repeat > alphabet) {
                throw new Error("A VP8L prefix code repeats past its alphabet");
            }
            lengths.fill(length === 16 ? previous : 0, symbol, symbol + repeat);
            symbol += repeat;
        }
        return this.built(lengths);
    }

    private mark(lengths: Uint8Array, symbol: number, alphabet: number): void {
        if (symbol >= alphabet) {
            throw new Error("A VP8L simple prefix code names a symbol outside its alphabet");
        }
        lengths[symbol] = 1;
    }

    private built(lengths: Uint8Array): PrefixCode {
        // A canonical code: the codes of each length follow those of the shorter ones in the order of the symbols. A code
        // with one symbol, or none, takes no bits (§3.7.2.1), and an empty one stands for the symbol 0.
        const counts: Uint16Array = new Uint16Array(MAXIMUM_LENGTH + 1);
        let used: number = 0;
        let last: number = 0;
        for (let symbol: number = 0; symbol < lengths.length; symbol++) {
            if (lengths[symbol] > 0) {
                counts[lengths[symbol]]++;
                used++;
                last = symbol;
            }
        }
        if (used <= 1) {
            return { single: last, counts, symbols: new Uint16Array(0) };
        }
        const offsets: Uint16Array = new Uint16Array(MAXIMUM_LENGTH + 2);
        for (let length: number = 1; length <= MAXIMUM_LENGTH; length++) {
            offsets[length + 1] = offsets[length] + counts[length];
        }
        const symbols: Uint16Array = new Uint16Array(used);
        for (let symbol: number = 0; symbol < lengths.length; symbol++) {
            if (lengths[symbol] > 0) {
                symbols[offsets[lengths[symbol]]++] = symbol;
            }
        }
        return { single: -1, counts, symbols };
    }

    private symbol(code: PrefixCode): number {
        if (code.single >= 0) {
            return code.single;
        }
        let value: number = 0;
        let first: number = 0;
        let index: number = 0;
        for (let length: number = 1; length <= MAXIMUM_LENGTH; length++) {
            value |= this.read(1);
            const count: number = code.counts[length];
            if (value - first < count) {
                return code.symbols[index + value - first];
            }
            index += count;
            first = (first + count) << 1;
            value <<= 1;
        }
        throw new Error("A VP8L prefix code has no symbol for the bits read");
    }

    private undone(transform: Transform, pixels: Uint32Array, height: number): Uint32Array {
        if (transform.type === SUBTRACT_GREEN) {
            // §3.5.3: the green value is added back to red and blue.
            for (let index: number = 0; index < pixels.length; index++) {
                const pixel: number = pixels[index];
                const green: number = (pixel >> 8) & 0xFF;
                pixels[index] = ((pixel & 0xFF00FF00) | ((((pixel >> 16) + green) & 0xFF) << 16) | ((pixel + green) & 0xFF)) >>> 0;
            }
            return pixels;
        }
        if (transform.type === CROSS_COLOR) {
            this.colored(transform, pixels, height);
            return pixels;
        }
        if (transform.type === PREDICTOR) {
            this.predicted(transform, pixels, height);
            return pixels;
        }
        return this.indexed(transform, pixels, height);
    }

    private predicted(transform: Transform, pixels: Uint32Array, height: number): void {
        // §3.5.1: the top-left pixel is predicted as opaque black, the top row from the left, the left column from above,
        // and the others by the mode of their block; on the right edge the top-right pixel is the first one of the row.
        const width: number = transform.width;
        const blocks: number = this.divided(width, transform.bits);
        for (let y: number = 0; y < height; y++) {
            for (let x: number = 0; x < width; x++) {
                const index: number = y * width + x;
                let prediction: number;
                if (y === 0) {
                    prediction = x === 0 ? 0xFF000000 : pixels[index - 1];
                } else if (x === 0) {
                    prediction = pixels[index - width];
                } else {
                    const mode: number = (transform.data[(y >> transform.bits) * blocks + (x >> transform.bits)] >> 8) & 0x0F;
                    const right: number = x === width - 1 ? pixels[index - x] : pixels[index - width + 1];
                    prediction = this.prediction(mode, pixels[index - 1], pixels[index - width], pixels[index - width - 1], right);
                }
                pixels[index] = this.added(pixels[index], prediction);
            }
        }
    }

    private prediction(mode: number, left: number, top: number, topLeft: number, topRight: number): number {
        switch (mode) {
            case 1:
                return left;
            case 2:
                return top;
            case 3:
                return topRight;
            case 4:
                return topLeft;
            case 5:
                return this.average(this.average(left, topRight), top);
            case 6:
                return this.average(left, topLeft);
            case 7:
                return this.average(left, top);
            case 8:
                return this.average(topLeft, top);
            case 9:
                return this.average(top, topRight);
            case 10:
                return this.average(this.average(left, topLeft), this.average(top, topRight));
            case 11:
                return this.select(left, top, topLeft);
            case 12:
                return this.clamped(left, top, topLeft, false);
            case 13:
                return this.clamped(this.average(left, top), topLeft, 0, true);
            default:
                return 0xFF000000;
        }
    }

    private added(first: number, second: number): number {
        return ((((first & 0xFF00FF00) + (second & 0xFF00FF00)) & 0xFF00FF00) | (((first & 0x00FF00FF) + (second & 0x00FF00FF)) & 0x00FF00FF)) >>> 0;
    }

    private average(first: number, second: number): number {
        return ((((first ^ second) & 0xFEFEFEFE) >>> 1) + (first & second)) >>> 0;
    }

    private select(left: number, top: number, topLeft: number): number {
        let toLeft: number = 0;
        let toTop: number = 0;
        for (let shift: number = 0; shift < 32; shift += 8) {
            const l: number = (left >>> shift) & 0xFF;
            const t: number = (top >>> shift) & 0xFF;
            const estimate: number = l + t - ((topLeft >>> shift) & 0xFF);
            toLeft += Math.abs(estimate - l);
            toTop += Math.abs(estimate - t);
        }
        return toLeft < toTop ? left : top;
    }

    private clamped(first: number, second: number, third: number, half: boolean): number {
        // §3.5.1: ClampAddSubtractFull is a + b - c, and ClampAddSubtractHalf is a + (a - b) / 2 with the division of C.
        let result: number = 0;
        for (let shift: number = 0; shift < 32; shift += 8) {
            const a: number = (first >>> shift) & 0xFF;
            const b: number = (second >>> shift) & 0xFF;
            const value: number = half ? a + Math.trunc((a - b) / 2) : a + b - ((third >>> shift) & 0xFF);
            result |= Math.min(255, Math.max(0, value)) << shift;
        }
        return result >>> 0;
    }

    private colored(transform: Transform, pixels: Uint32Array, height: number): void {
        // §3.5.2: each block holds green_to_red in its blue byte, green_to_blue in its green byte and red_to_blue in its red
        // byte, signed numbers of 3.5 fixed point.
        const width: number = transform.width;
        const blocks: number = this.divided(width, transform.bits);
        for (let y: number = 0; y < height; y++) {
            for (let x: number = 0; x < width; x++) {
                const element: number = transform.data[(y >> transform.bits) * blocks + (x >> transform.bits)];
                const index: number = y * width + x;
                const pixel: number = pixels[index];
                const green: number = (pixel >> 8) & 0xFF;
                const red: number = (((pixel >> 16) & 0xFF) + this.delta(element & 0xFF, green)) & 0xFF;
                const blue: number = ((pixel & 0xFF) + this.delta((element >> 8) & 0xFF, green) + this.delta((element >> 16) & 0xFF, red)) & 0xFF;
                pixels[index] = ((pixel & 0xFF00FF00) | (red << 16) | blue) >>> 0;
            }
        }
    }

    private delta(factor: number, color: number): number {
        return ((factor << 24 >> 24) * (color << 24 >> 24)) >> 5;
    }

    private indexed(transform: Transform, pixels: Uint32Array, height: number): Uint32Array {
        // §3.5.4: the green value is an index into the color table, several of them in one pixel when bundled; an index
        // past the table is transparent black.
        const width: number = transform.width;
        const packed: number = this.divided(width, transform.bits);
        const size: number = 8 >> transform.bits;
        const mask: number = (1 << size) - 1;
        const table: Uint32Array = transform.data;
        const result: Uint32Array = new Uint32Array(width * height);
        for (let y: number = 0; y < height; y++) {
            for (let x: number = 0; x < width; x++) {
                const green: number = (pixels[y * packed + (x >> transform.bits)] >> 8) & 0xFF;
                const index: number = transform.bits === 0 ? green : (green >> ((x & ((1 << transform.bits) - 1)) * size)) & mask;
                result[y * width + x] = index < table.length ? table[index] : 0;
            }
        }
        return result;
    }
}
