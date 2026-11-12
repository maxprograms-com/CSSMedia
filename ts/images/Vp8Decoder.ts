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

import { AC_QUANT, COEFF_UPDATE_PROBS, DC_QUANT, DEFAULT_COEFF_PROBS, KF_BMODE_PROBS } from "./generated/Vp8Tables.js";

export interface LossyImage {
    width: number;
    height: number;
    y: Uint8Array;
    u: Uint8Array;
    v: Uint8Array;
    yStride: number;
    uvStride: number;
    yOrigin: number;
    uvOrigin: number;
}

interface BoolDecoder {
    data: Buffer;
    position: number;
    end: number;
    value: number;
    range: number;
    count: number;
}

interface Frame {
    mbColumns: number;
    mbRows: number;
    segmentation: boolean;
    updateMap: boolean;
    absolute: boolean;
    segmentQuant: Int32Array;
    segmentFilter: Int32Array;
    treeProbs: Uint8Array;
    simple: boolean;
    level: number;
    sharpness: number;
    deltas: boolean;
    referenceDelta: Int32Array;
    modeDelta: Int32Array;
    coefficientProbs: Uint8Array;
    skipEnabled: boolean;
    skipProb: number;
    factors: Int32Array;
}

const DC_PRED: number = 0;
const V_PRED: number = 1;
const H_PRED: number = 2;
const TM_PRED: number = 3;
const B_PRED: number = 4;
const B_DC_PRED: number = 0;
const B_TM_PRED: number = 1;
const B_VE_PRED: number = 2;
const B_HE_PRED: number = 3;
const B_LD_PRED: number = 4;
const B_RD_PRED: number = 5;
const B_VR_PRED: number = 6;
const B_VL_PRED: number = 7;
const B_HD_PRED: number = 8;
const IMPLIED_BMODES: ReadonlyArray<number> = [B_DC_PRED, B_VE_PRED, B_HE_PRED, B_TM_PRED];
const KF_YMODE_TREE: ReadonlyArray<number> = [-B_PRED, 2, 4, 6, -DC_PRED, -V_PRED, -H_PRED, -TM_PRED];
const KF_YMODE_PROBS: ReadonlyArray<number> = [145, 156, 163, 128];
const UV_MODE_TREE: ReadonlyArray<number> = [-DC_PRED, 2, -V_PRED, 4, -H_PRED, -TM_PRED];
const KF_UV_MODE_PROBS: ReadonlyArray<number> = [142, 114, 183];
const BMODE_TREE: ReadonlyArray<number> = [-B_DC_PRED, 2, -B_TM_PRED, 4, -B_VE_PRED, 6, 8, 12, -B_HE_PRED, 10, -B_RD_PRED, -B_VR_PRED, -B_LD_PRED, 14, -B_VL_PRED, 16,
    -B_HD_PRED, -9];
const BANDS: ReadonlyArray<number> = [0, 1, 2, 3, 6, 4, 5, 6, 6, 6, 6, 6, 6, 6, 6, 7];
const ZIGZAG: ReadonlyArray<number> = [0, 1, 4, 8, 5, 2, 3, 6, 9, 12, 13, 10, 7, 11, 14, 15];
const LEFT_CONTEXT: ReadonlyArray<number> = [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8];
const ABOVE_CONTEXT: ReadonlyArray<number> = [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 4, 5, 4, 5, 6, 7, 6, 7, 8];
const CATEGORY_MINIMUMS: ReadonlyArray<number> = [5, 7, 11, 19, 35, 67];
const CATEGORY_PROBS: ReadonlyArray<ReadonlyArray<number>> = [
    [159], [145, 165], [140, 148, 173], [135, 140, 155, 176], [130, 134, 141, 157, 180], [129, 130, 133, 140, 153, 177, 196, 230, 243, 254, 254]
];
const NODES: number = 11;
const BLOCK_Y_AFTER_Y2: number = 0;
const BLOCK_Y2: number = 1;
const BLOCK_UV: number = 2;
const BLOCK_Y: number = 3;
const COSINE: number = 20091;
const SINE: number = 35468;
const LEFT_BORDER: number = 1;
const RIGHT_BORDER: number = 4;

export class Vp8Decoder {

    decode(data: Buffer): LossyImage {
        // RFC 6386 §9.1 and §19.1: a three-byte frame tag, and for a key frame the start code, the width and the height;
        // WebP holds one key frame.
        if (data.length < 10 || (data[0] & 1) !== 0) {
            throw new Error("The VP8 bitstream is not a key frame");
        }
        const firstPartition: number = (data[0] | (data[1] << 8) | (data[2] << 16)) >>> 5;
        if (data[3] !== 0x9D || data[4] !== 0x01 || data[5] !== 0x2A) {
            throw new Error("The VP8 key frame has no start code");
        }
        const width: number = data.readUInt16LE(6) & 0x3FFF;
        const height: number = data.readUInt16LE(8) & 0x3FFF;
        if (width === 0 || height === 0 || 10 + firstPartition > data.length) {
            throw new Error("The VP8 key frame has no size or is truncated");
        }
        const header: BoolDecoder = this.boolDecoder(data, 10, 10 + firstPartition);
        const frame: Frame = this.frameHeader(header, width, height);
        const partitions: Array<BoolDecoder> = this.partitions(header, data, 10 + firstPartition);
        this.entropyHeader(header, frame);
        return this.frame(header, partitions, frame, width, height);
    }

    private boolDecoder(data: Buffer, start: number, end: number): BoolDecoder {
        // §7.3 and §20.2: the value starts with the first two bytes of the partition and the range at 255.
        const decoder: BoolDecoder = { data, position: start, end, value: 0, range: 255, count: 0 };
        if (end - start >= 2) {
            decoder.value = (data[start] << 8) | data[start + 1];
            decoder.position = start + 2;
        } else {
            decoder.position = end;
        }
        return decoder;
    }

    private bool(decoder: BoolDecoder, probability: number): number {
        const split: number = 1 + (((decoder.range - 1) * probability) >> 8);
        const bigSplit: number = split << 8;
        let bit: number;
        if (decoder.value >= bigSplit) {
            bit = 1;
            decoder.range -= split;
            decoder.value -= bigSplit;
        } else {
            bit = 0;
            decoder.range = split;
        }
        while (decoder.range < 128) {
            decoder.value <<= 1;
            decoder.range <<= 1;
            if (++decoder.count === 8) {
                decoder.count = 0;
                if (decoder.position < decoder.end) {
                    decoder.value |= decoder.data[decoder.position++];
                }
            }
        }
        return bit;
    }

    private literal(decoder: BoolDecoder, bits: number): number {
        let value: number = 0;
        for (let bit: number = bits - 1; bit >= 0; bit--) {
            value |= this.bool(decoder, 128) << bit;
        }
        return value;
    }

    private signed(decoder: BoolDecoder, bits: number): number {
        // §19.2: a flag, then the magnitude and its sign.
        if (this.bool(decoder, 128) === 0) {
            return 0;
        }
        const magnitude: number = this.literal(decoder, bits);
        return this.bool(decoder, 128) === 1 ? -magnitude : magnitude;
    }

    private tree(decoder: BoolDecoder, tree: ReadonlyArray<number>, probabilities: ReadonlyArray<number> | Uint8Array, offset: number = 0): number {
        // §8.1: a leaf is a non-positive entry, whose negation is the value.
        let index: number = 0;
        while ((index = tree[index + this.bool(decoder, probabilities[offset + (index >> 1)])]) > 0) {
            continue;
        }
        return -index;
    }

    private frameHeader(decoder: BoolDecoder, width: number, height: number): Frame {
        // §9.2 to §9.6 and §19.2: color space and clamping, segmentation, the loop filter, then the partitions and the
        // quantizer indices, in the order of the reference decoder.
        if (this.literal(decoder, 1) !== 0) {
            throw new Error("The VP8 key frame uses a reserved color space");
        }
        this.literal(decoder, 1);
        const frame: Frame = {
            mbColumns: (width + 15) >> 4, mbRows: (height + 15) >> 4, segmentation: false, updateMap: false, absolute: false,
            segmentQuant: new Int32Array(4), segmentFilter: new Int32Array(4), treeProbs: new Uint8Array([255, 255, 255]), simple: false, level: 0, sharpness: 0,
            deltas: false, referenceDelta: new Int32Array(4), modeDelta: new Int32Array(4), coefficientProbs: Uint8Array.from(DEFAULT_COEFF_PROBS), skipEnabled: false,
            skipProb: 0, factors: new Int32Array(4 * 6)
        };
        frame.segmentation = this.literal(decoder, 1) === 1;
        if (frame.segmentation) {
            frame.updateMap = this.literal(decoder, 1) === 1;
            const updateData: boolean = this.literal(decoder, 1) === 1;
            if (updateData) {
                frame.absolute = this.literal(decoder, 1) === 1;
                for (let segment: number = 0; segment < 4; segment++) {
                    frame.segmentQuant[segment] = this.signed(decoder, 7);
                }
                for (let segment: number = 0; segment < 4; segment++) {
                    frame.segmentFilter[segment] = this.signed(decoder, 6);
                }
            }
            if (frame.updateMap) {
                for (let index: number = 0; index < 3; index++) {
                    frame.treeProbs[index] = this.literal(decoder, 1) === 1 ? this.literal(decoder, 8) : 255;
                }
            }
        }
        frame.simple = this.literal(decoder, 1) === 1;
        frame.level = this.literal(decoder, 6);
        frame.sharpness = this.literal(decoder, 3);
        frame.deltas = this.literal(decoder, 1) === 1;
        if (frame.deltas && this.literal(decoder, 1) === 1) {
            for (let index: number = 0; index < 4; index++) {
                frame.referenceDelta[index] = this.signed(decoder, 6);
            }
            for (let index: number = 0; index < 4; index++) {
                frame.modeDelta[index] = this.signed(decoder, 6);
            }
        }
        return frame;
    }

    private partitions(decoder: BoolDecoder, data: Buffer, start: number): Array<BoolDecoder> {
        // §9.5: the number of DCT token partitions, and the sizes of all but the last one in three bytes each.
        const count: number = 1 << this.literal(decoder, 2);
        let position: number = start + 3 * (count - 1);
        if (position > data.length) {
            throw new Error("The VP8 partition sizes are truncated");
        }
        const partitions: Array<BoolDecoder> = [];
        for (let index: number = 0; index < count; index++) {
            const size: number = index < count - 1 ? data[start + index * 3] | (data[start + index * 3 + 1] << 8) | (data[start + index * 3 + 2] << 16) : data.length - position;
            if (position + size > data.length) {
                throw new Error("The VP8 partition " + index + " is truncated");
            }
            partitions.push(this.boolDecoder(data, position, position + size));
            position += size;
        }
        return partitions;
    }

    private entropyHeader(decoder: BoolDecoder, frame: Frame): void {
        // §9.6: the quantizer indices; §9.7 and §9.11: refresh_entropy_probs; §9.9 and §13.4: the coefficient probability
        // updates; §9.11: the probability that a macroblock has no non-zero coefficients.
        const index: number = this.literal(decoder, 7);
        const yDcDelta: number = this.signed(decoder, 4);
        const y2DcDelta: number = this.signed(decoder, 4);
        const y2AcDelta: number = this.signed(decoder, 4);
        const uvDcDelta: number = this.signed(decoder, 4);
        const uvAcDelta: number = this.signed(decoder, 4);
        this.literal(decoder, 1);
        for (let entry: number = 0; entry < COEFF_UPDATE_PROBS.length; entry++) {
            if (this.bool(decoder, COEFF_UPDATE_PROBS[entry]) === 1) {
                frame.coefficientProbs[entry] = this.literal(decoder, 8);
            }
        }
        frame.skipEnabled = this.literal(decoder, 1) === 1;
        if (frame.skipEnabled) {
            frame.skipProb = this.literal(decoder, 8);
        }
        // §14.1 and §20.4: the factors of each segment, with Y2 DC doubled, Y2 AC at 155/100 and at least 8, and UV DC at
        // most 132.
        for (let segment: number = 0; segment < 4; segment++) {
            let q: number = index;
            if (frame.segmentation) {
                q = frame.absolute ? frame.segmentQuant[segment] : q + frame.segmentQuant[segment];
            }
            const base: number = segment * 6;
            frame.factors[base] = this.quantizer(DC_QUANT, q + yDcDelta);
            frame.factors[base + 1] = this.quantizer(AC_QUANT, q);
            frame.factors[base + 2] = this.quantizer(DC_QUANT, q + y2DcDelta) * 2;
            frame.factors[base + 3] = Math.max(8, Math.trunc(this.quantizer(AC_QUANT, q + y2AcDelta) * 155 / 100));
            frame.factors[base + 4] = Math.min(132, this.quantizer(DC_QUANT, q + uvDcDelta));
            frame.factors[base + 5] = this.quantizer(AC_QUANT, q + uvAcDelta);
        }
    }

    private quantizer(table: ReadonlyArray<number>, index: number): number {
        return table[Math.min(127, Math.max(0, index))];
    }

    private frame(header: BoolDecoder, partitions: ReadonlyArray<BoolDecoder>, frame: Frame, width: number, height: number): LossyImage {
        // §19.3: the modes of each macroblock in the first partition and its tokens in the partition of its row; the
        // macroblocks are predicted from the frame before the loop filter, which §15 applies to the whole frame after.
        const columns: number = frame.mbColumns;
        const yStride: number = columns * 16 + LEFT_BORDER + RIGHT_BORDER;
        const uvStride: number = columns * 8 + LEFT_BORDER + RIGHT_BORDER;
        const image: LossyImage = {
            width, height, yStride, uvStride, yOrigin: yStride + LEFT_BORDER, uvOrigin: uvStride + LEFT_BORDER,
            y: new Uint8Array(yStride * (frame.mbRows * 16 + 1)), u: new Uint8Array(uvStride * (frame.mbRows * 8 + 1)), v: new Uint8Array(uvStride * (frame.mbRows * 8 + 1))
        };
        const total: number = columns * frame.mbRows;
        const yModes: Uint8Array = new Uint8Array(total);
        const segments: Uint8Array = new Uint8Array(total);
        const filtered: Uint8Array = new Uint8Array(total);
        const aboveModes: Uint8Array = new Uint8Array(columns * 4);
        const leftModes: Uint8Array = new Uint8Array(4);
        const aboveTokens: Uint8Array = new Uint8Array(columns * 9);
        const leftTokens: Uint8Array = new Uint8Array(9);
        const modes: Uint8Array = new Uint8Array(16);
        const coefficients: Int16Array = new Int16Array(25 * 16);
        for (let row: number = 0; row < frame.mbRows; row++) {
            leftModes.fill(B_DC_PRED);
            leftTokens.fill(0);
            const tokens: BoolDecoder = partitions[row % partitions.length];
            for (let column: number = 0; column < columns; column++) {
                const index: number = row * columns + column;
                let segment: number = 0;
                if (frame.updateMap) {
                    segment = this.bool(header, frame.treeProbs[0]) === 1 ? 2 + this.bool(header, frame.treeProbs[2]) : this.bool(header, frame.treeProbs[1]);
                }
                const skip: boolean = frame.skipEnabled && this.bool(header, frame.skipProb) === 1;
                const yMode: number = this.tree(header, KF_YMODE_TREE, KF_YMODE_PROBS);
                if (yMode === B_PRED) {
                    // §11.3: each subblock mode in the context of the modes above and to the left of it.
                    for (let block: number = 0; block < 16; block++) {
                        const above: number = block < 4 ? aboveModes[column * 4 + block] : modes[block - 4];
                        const left: number = (block & 3) === 0 ? leftModes[block >> 2] : modes[block - 1];
                        modes[block] = this.tree(header, BMODE_TREE, KF_BMODE_PROBS, (above * 10 + left) * 9);
                    }
                } else {
                    modes.fill(IMPLIED_BMODES[yMode]);
                }
                for (let position: number = 0; position < 4; position++) {
                    aboveModes[column * 4 + position] = modes[12 + position];
                    leftModes[position] = modes[position * 4 + 3];
                }
                const uvMode: number = this.tree(header, UV_MODE_TREE, KF_UV_MODE_PROBS);
                coefficients.fill(0);
                let nonZero: boolean = false;
                if (skip) {
                    leftTokens.fill(0, 0, 8);
                    aboveTokens.fill(0, column * 9, column * 9 + 8);
                    if (yMode !== B_PRED) {
                        leftTokens[8] = 0;
                        aboveTokens[column * 9 + 8] = 0;
                    }
                } else {
                    nonZero = this.macroblockTokens(tokens, frame, segment, yMode, coefficients, leftTokens, aboveTokens, column * 9);
                }
                yModes[index] = yMode;
                segments[index] = segment;
                filtered[index] = nonZero || yMode === B_PRED ? 1 : 0;
                this.reconstructed(image, row, column, yMode, uvMode, modes, coefficients);
            }
            // §20.14: the four pixels right of the last macroblock of the row repeat its last pixel, for the above-right
            // subblocks of the row below.
            const last: number = image.yOrigin + (row * 16 + 15) * yStride + columns * 16;
            image.y.fill(image.y[last - 1], last, last + RIGHT_BORDER);
        }
        if (frame.level > 0) {
            this.loopFilter(image, frame, yModes, segments, filtered);
        }
        return image;
    }

    private macroblockTokens(decoder: BoolDecoder, frame: Frame, segment: number, yMode: number, coefficients: Int16Array, left: Uint8Array, above: Uint8Array,
        aboveBase: number): boolean {
        // §13 and §20.16: the Y2 block when the luma mode is not B_PRED, then the 16 Y blocks, starting at their second
        // coefficient after a Y2 block, then the 4 U and the 4 V blocks; each sets the context of the blocks after it.
        const factors: number = segment * 6;
        let nonZero: boolean = false;
        let firstY: number = 0;
        let yType: number = BLOCK_Y;
        if (yMode !== B_PRED) {
            const data: number = this.blockTokens(decoder, frame, BLOCK_Y2, left[8] + above[aboveBase + 8], coefficients, 24 * 16, frame.factors[factors + 2],
                frame.factors[factors + 3]);
            left[8] = above[aboveBase + 8] = data;
            nonZero = data === 1;
            firstY = 1;
            yType = BLOCK_Y_AFTER_Y2;
        }
        for (let block: number = 0; block < 24; block++) {
            const luma: boolean = block < 16;
            const leftIndex: number = LEFT_CONTEXT[block];
            const aboveIndex: number = aboveBase + ABOVE_CONTEXT[block];
            const data: number = this.blockTokens(decoder, frame, luma ? yType : BLOCK_UV, left[leftIndex] + above[aboveIndex], coefficients, block * 16,
                frame.factors[factors + (luma ? 0 : 4)], frame.factors[factors + (luma ? 1 : 5)], luma ? firstY : 0);
            left[leftIndex] = above[aboveIndex] = data;
            nonZero = nonZero || data === 1;
        }
        return nonZero;
    }

    private blockTokens(decoder: BoolDecoder, frame: Frame, type: number, context: number, coefficients: Int16Array, offset: number, dcFactor: number, acFactor: number,
        first: number = 0): number {
        // §13.2 and §20.16: no end of block can follow a zero, and each token sets the context of the next one to 0, 1 or
        // 2 for a zero, a one or more; a block has data when any token was read before its end.
        const probs: Uint8Array = frame.coefficientProbs;
        let position: number = first;
        let context3: number = context;
        let afterZero: boolean = false;
        for (; ;) {
            const base: number = ((type * 8 + BANDS[position]) * 3 + context3) * NODES;
            if (!afterZero && this.bool(decoder, probs[base]) === 0) {
                break;
            }
            if (this.bool(decoder, probs[base + 1]) === 0) {
                if (position === 15) {
                    break;
                }
                position++;
                context3 = 0;
                afterZero = true;
                continue;
            }
            let value: number;
            if (this.bool(decoder, probs[base + 2]) === 0) {
                value = 1;
            } else if (this.bool(decoder, probs[base + 3]) === 0) {
                value = this.bool(decoder, probs[base + 4]) === 0 ? 2 : (this.bool(decoder, probs[base + 5]) === 0 ? 3 : 4);
            } else if (this.bool(decoder, probs[base + 6]) === 0) {
                value = this.category(decoder, this.bool(decoder, probs[base + 7]) === 0 ? 0 : 1);
            } else if (this.bool(decoder, probs[base + 8]) === 0) {
                value = this.category(decoder, this.bool(decoder, probs[base + 9]) === 0 ? 2 : 3);
            } else {
                value = this.category(decoder, this.bool(decoder, probs[base + 10]) === 0 ? 4 : 5);
            }
            const signedValue: number = this.bool(decoder, 128) === 1 ? -value : value;
            coefficients[offset + ZIGZAG[position]] = signedValue * (position > 0 ? acFactor : dcFactor);
            if (position === 15) {
                break;
            }
            position++;
            context3 = value === 1 ? 1 : 2;
            afterZero = false;
        }
        return position !== first ? 1 : 0;
    }

    private category(decoder: BoolDecoder, category: number): number {
        // §13.2: the extra bits of a category, the most significant first.
        const probs: ReadonlyArray<number> = CATEGORY_PROBS[category];
        let value: number = 0;
        for (let bit: number = probs.length - 1; bit >= 0; bit--) {
            value += this.bool(decoder, probs[bit]) << bit;
        }
        return CATEGORY_MINIMUMS[category] + value;
    }

    private reconstructed(image: LossyImage, row: number, column: number, yMode: number, uvMode: number, modes: Uint8Array, coefficients: Int16Array): void {
        // §12 and §20.14: the edges outside the frame are 127 above and 129 on the left, except that DC prediction on the
        // top row or the left column averages only the edge inside the frame.
        const y: Uint8Array = image.y;
        const yStride: number = image.yStride;
        const luma: number = image.yOrigin + row * 16 * yStride + column * 16;
        const chroma: number = image.uvOrigin + row * 8 * image.uvStride + column * 8;
        if (column === 0) {
            this.leftEdge(y, luma, 16, yStride, row, yMode);
            this.leftEdge(image.u, chroma, 8, image.uvStride, row, uvMode);
            this.leftEdge(image.v, chroma, 8, image.uvStride, row, uvMode);
            if (row === 0) {
                y[luma - yStride - 1] = 127;
            }
        }
        if (row === 0) {
            this.topEdge(y, luma, 16, yStride, column, yMode);
            this.topEdge(image.u, chroma, 8, image.uvStride, column, uvMode);
            this.topEdge(image.v, chroma, 8, image.uvStride, column, uvMode);
        }
        if (yMode === B_PRED) {
            // §12.3: the four pixels above and right of the macroblock serve the right-hand subblocks of every row.
            for (let line: number = 3; line < 16; line += 4) {
                y.copyWithin(luma + line * yStride + 16, luma - yStride + 16, luma - yStride + 20);
            }
            for (let block: number = 0; block < 16; block++) {
                const at: number = luma + (block >> 2) * 4 * yStride + (block & 3) * 4;
                this.subblock(y, at, yStride, modes[block]);
                this.inverseDct(y, at, yStride, coefficients, block * 16);
            }
        } else {
            this.predicted(y, luma, yStride, 16, yMode);
            this.inverseWht(coefficients);
            for (let block: number = 0; block < 16; block++) {
                this.inverseDct(y, luma + (block >> 2) * 4 * yStride + (block & 3) * 4, yStride, coefficients, block * 16);
            }
        }
        this.predicted(image.u, chroma, image.uvStride, 8, uvMode);
        this.predicted(image.v, chroma, image.uvStride, 8, uvMode);
        for (let block: number = 0; block < 4; block++) {
            const at: number = chroma + (block >> 1) * 4 * image.uvStride + (block & 1) * 4;
            this.inverseDct(image.u, at, image.uvStride, coefficients, (16 + block) * 16);
            this.inverseDct(image.v, at, image.uvStride, coefficients, (20 + block) * 16);
        }
    }

    private leftEdge(plane: Uint8Array, at: number, size: number, stride: number, row: number, mode: number): void {
        if (mode === DC_PRED && row > 0) {
            for (let line: number = 0; line < size; line++) {
                plane[at + line * stride - 1] = plane[at - stride + line];
            }
            return;
        }
        for (let line: number = -1; line < size; line++) {
            plane[at + line * stride - 1] = 129;
        }
    }

    private topEdge(plane: Uint8Array, at: number, size: number, stride: number, column: number, mode: number): void {
        const above: number = at - stride;
        if (mode === DC_PRED && column > 0) {
            for (let index: number = 0; index < size; index++) {
                plane[above + index] = plane[at + index * stride - 1];
            }
        } else {
            plane.fill(127, above - 1, above + size);
        }
        plane.fill(127, above + size, above + size + 4);
    }

    private predicted(plane: Uint8Array, at: number, stride: number, size: number, mode: number): void {
        // §12.2: DC, vertical, horizontal and TrueMotion prediction of a whole macroblock.
        const above: number = at - stride;
        if (mode === DC_PRED) {
            let sum: number = 0;
            for (let index: number = 0; index < size; index++) {
                sum += plane[at + index * stride - 1] + plane[above + index];
            }
            const shift: number = size === 16 ? 5 : 4;
            const value: number = (sum + (1 << (shift - 1))) >> shift;
            for (let line: number = 0; line < size; line++) {
                plane.fill(value, at + line * stride, at + line * stride + size);
            }
        } else if (mode === V_PRED) {
            for (let line: number = 0; line < size; line++) {
                plane.copyWithin(at + line * stride, above, above + size);
            }
        } else if (mode === H_PRED) {
            for (let line: number = 0; line < size; line++) {
                plane.fill(plane[at + line * stride - 1], at + line * stride, at + line * stride + size);
            }
        } else {
            this.trueMotion(plane, at, stride, size);
        }
    }

    private trueMotion(plane: Uint8Array, at: number, stride: number, size: number): void {
        const above: number = at - stride;
        const corner: number = plane[above - 1];
        for (let line: number = 0; line < size; line++) {
            const left: number = plane[at + line * stride - 1];
            for (let index: number = 0; index < size; index++) {
                plane[at + line * stride + index] = this.clamp(left + plane[above + index] - corner);
            }
        }
    }

    private subblock(plane: Uint8Array, at: number, stride: number, mode: number): void {
        // §12.3 and §20.14: the ten subblock modes, from the row above (with the four pixels above and right), the column
        // to the left and the pixel above and left.
        const a: (index: number) => number = (index: number): number => plane[at - stride + index];
        const l: (index: number) => number = (index: number): number => plane[at + index * stride - 1];
        const put: (x: number, line: number, value: number) => void = (x: number, line: number, value: number): void => {
            plane[at + line * stride + x] = value;
        };
        const three: (first: number, second: number, third: number) => number = (first: number, second: number, third: number): number =>
            (first + 2 * second + third + 2) >> 2;
        const two: (first: number, second: number) => number = (first: number, second: number): number => (first + second + 1) >> 1;
        switch (mode) {
            case B_DC_PRED: {
                let sum: number = 4;
                for (let index: number = 0; index < 4; index++) {
                    sum += a(index) + l(index);
                }
                for (let line: number = 0; line < 4; line++) {
                    plane.fill(sum >> 3, at + line * stride, at + line * stride + 4);
                }
                break;
            }
            case B_TM_PRED:
                this.trueMotion(plane, at, stride, 4);
                break;
            case B_VE_PRED:
                for (let x: number = 0; x < 4; x++) {
                    const value: number = three(a(x - 1), a(x), a(x + 1));
                    for (let line: number = 0; line < 4; line++) {
                        put(x, line, value);
                    }
                }
                break;
            case B_HE_PRED: {
                const values: ReadonlyArray<number> = [three(a(-1), l(0), l(1)), three(l(0), l(1), l(2)), three(l(1), l(2), l(3)), three(l(2), l(3), l(3))];
                for (let line: number = 0; line < 4; line++) {
                    plane.fill(values[line], at + line * stride, at + line * stride + 4);
                }
                break;
            }
            case B_LD_PRED:
                for (let line: number = 0; line < 4; line++) {
                    for (let x: number = 0; x < 4; x++) {
                        const index: number = line + x;
                        put(x, line, index === 6 ? three(a(6), a(7), a(7)) : three(a(index), a(index + 1), a(index + 2)));
                    }
                }
                break;
            case B_RD_PRED: {
                // The edge from the bottom of the left column up through the corner to the end of the row above.
                const edge: ReadonlyArray<number> = [l(3), l(2), l(1), l(0), a(-1), a(0), a(1), a(2), a(3)];
                for (let line: number = 0; line < 4; line++) {
                    for (let x: number = 0; x < 4; x++) {
                        const index: number = 3 - line + x;
                        put(x, line, three(edge[index], edge[index + 1], edge[index + 2]));
                    }
                }
                break;
            }
            case B_VR_PRED:
                put(0, 0, two(a(-1), a(0)));
                put(1, 0, two(a(0), a(1)));
                put(2, 0, two(a(1), a(2)));
                put(3, 0, two(a(2), a(3)));
                put(0, 1, three(l(0), a(-1), a(0)));
                put(1, 1, three(a(-1), a(0), a(1)));
                put(2, 1, three(a(0), a(1), a(2)));
                put(3, 1, three(a(1), a(2), a(3)));
                put(0, 2, three(l(1), l(0), a(-1)));
                put(1, 2, two(a(-1), a(0)));
                put(2, 2, two(a(0), a(1)));
                put(3, 2, two(a(1), a(2)));
                put(0, 3, three(l(2), l(1), l(0)));
                put(1, 3, three(l(0), a(-1), a(0)));
                put(2, 3, three(a(-1), a(0), a(1)));
                put(3, 3, three(a(0), a(1), a(2)));
                break;
            case B_VL_PRED:
                put(0, 0, two(a(0), a(1)));
                put(1, 0, two(a(1), a(2)));
                put(2, 0, two(a(2), a(3)));
                put(3, 0, two(a(3), a(4)));
                put(0, 1, three(a(0), a(1), a(2)));
                put(1, 1, three(a(1), a(2), a(3)));
                put(2, 1, three(a(2), a(3), a(4)));
                put(3, 1, three(a(3), a(4), a(5)));
                put(0, 2, two(a(1), a(2)));
                put(1, 2, two(a(2), a(3)));
                put(2, 2, two(a(3), a(4)));
                put(3, 2, three(a(4), a(5), a(6)));
                put(0, 3, three(a(1), a(2), a(3)));
                put(1, 3, three(a(2), a(3), a(4)));
                put(2, 3, three(a(3), a(4), a(5)));
                put(3, 3, three(a(5), a(6), a(7)));
                break;
            case B_HD_PRED:
                put(0, 0, two(l(0), a(-1)));
                put(1, 0, three(l(0), a(-1), a(0)));
                put(2, 0, three(a(-1), a(0), a(1)));
                put(3, 0, three(a(0), a(1), a(2)));
                put(0, 1, two(l(1), l(0)));
                put(1, 1, three(l(1), l(0), a(-1)));
                put(2, 1, two(l(0), a(-1)));
                put(3, 1, three(l(0), a(-1), a(0)));
                put(0, 2, two(l(2), l(1)));
                put(1, 2, three(l(2), l(1), l(0)));
                put(2, 2, two(l(1), l(0)));
                put(3, 2, three(l(1), l(0), a(-1)));
                put(0, 3, two(l(3), l(2)));
                put(1, 3, three(l(3), l(2), l(1)));
                put(2, 3, two(l(2), l(1)));
                put(3, 3, three(l(2), l(1), l(0)));
                break;
            default:
                put(0, 0, two(l(0), l(1)));
                put(1, 0, three(l(0), l(1), l(2)));
                put(2, 0, two(l(1), l(2)));
                put(3, 0, three(l(1), l(2), l(3)));
                put(0, 1, two(l(1), l(2)));
                put(1, 1, three(l(1), l(2), l(3)));
                put(2, 1, two(l(2), l(3)));
                put(3, 1, three(l(2), l(3), l(3)));
                put(0, 2, two(l(2), l(3)));
                put(1, 2, three(l(2), l(3), l(3)));
                put(2, 2, l(3));
                put(3, 2, l(3));
                plane.fill(l(3), at + 3 * stride, at + 3 * stride + 4);
                break;
        }
    }

    private inverseWht(coefficients: Int16Array): void {
        // §14.3 and §20.8: the second-order block gives the DC coefficient of each luma block.
        const input: number = 24 * 16;
        const output: Int16Array = new Int16Array(16);
        for (let index: number = 0; index < 4; index++) {
            const a1: number = coefficients[input + index] + coefficients[input + 12 + index];
            const b1: number = coefficients[input + 4 + index] + coefficients[input + 8 + index];
            const c1: number = coefficients[input + 4 + index] - coefficients[input + 8 + index];
            const d1: number = coefficients[input + index] - coefficients[input + 12 + index];
            output[index] = a1 + b1;
            output[4 + index] = c1 + d1;
            output[8 + index] = a1 - b1;
            output[12 + index] = d1 - c1;
        }
        for (let line: number = 0; line < 4; line++) {
            const base: number = line * 4;
            const a1: number = output[base] + output[base + 3];
            const b1: number = output[base + 1] + output[base + 2];
            const c1: number = output[base + 1] - output[base + 2];
            const d1: number = output[base] - output[base + 3];
            coefficients[base * 16] = (a1 + b1 + 3) >> 3;
            coefficients[(base + 1) * 16] = (c1 + d1 + 3) >> 3;
            coefficients[(base + 2) * 16] = (a1 - b1 + 3) >> 3;
            coefficients[(base + 3) * 16] = (d1 - c1 + 3) >> 3;
        }
    }

    private inverseDct(plane: Uint8Array, at: number, stride: number, coefficients: Int16Array, offset: number): void {
        // §14.4 and §20.8: the columns first into 16-bit values, then the rows, added to the prediction; a block with only
        // its DC coefficient adds the same value everywhere.
        let only: boolean = true;
        for (let index: number = 1; index < 16 && only; index++) {
            only = coefficients[offset + index] === 0;
        }
        if (only) {
            const value: number = (coefficients[offset] + 4) >> 3;
            if (value !== 0) {
                for (let line: number = 0; line < 4; line++) {
                    for (let x: number = 0; x < 4; x++) {
                        plane[at + line * stride + x] = this.clamp(plane[at + line * stride + x] + value);
                    }
                }
            }
            return;
        }
        const columns: Int16Array = new Int16Array(16);
        for (let index: number = 0; index < 4; index++) {
            const c0: number = coefficients[offset + index];
            const c4: number = coefficients[offset + 4 + index];
            const c8: number = coefficients[offset + 8 + index];
            const c12: number = coefficients[offset + 12 + index];
            const a1: number = c0 + c8;
            const b1: number = c0 - c8;
            const c1: number = ((c4 * SINE) >> 16) - (c12 + ((c12 * COSINE) >> 16));
            const d1: number = (c4 + ((c4 * COSINE) >> 16)) + ((c12 * SINE) >> 16);
            columns[index] = a1 + d1;
            columns[12 + index] = a1 - d1;
            columns[4 + index] = b1 + c1;
            columns[8 + index] = b1 - c1;
        }
        for (let line: number = 0; line < 4; line++) {
            const base: number = line * 4;
            const a1: number = columns[base] + columns[base + 2];
            const b1: number = columns[base] - columns[base + 2];
            const c1: number = ((columns[base + 1] * SINE) >> 16) - (columns[base + 3] + ((columns[base + 3] * COSINE) >> 16));
            const d1: number = (columns[base + 1] + ((columns[base + 1] * COSINE) >> 16)) + ((columns[base + 3] * SINE) >> 16);
            const row: number = at + line * stride;
            plane[row] = this.clamp(plane[row] + ((a1 + d1 + 4) >> 3));
            plane[row + 3] = this.clamp(plane[row + 3] + ((a1 - d1 + 4) >> 3));
            plane[row + 1] = this.clamp(plane[row + 1] + ((b1 + c1 + 4) >> 3));
            plane[row + 2] = this.clamp(plane[row + 2] + ((b1 - c1 + 4) >> 3));
        }
    }

    private clamp(value: number): number {
        return value < 0 ? 0 : (value > 255 ? 255 : value);
    }

    private loopFilter(image: LossyImage, frame: Frame, yModes: Uint8Array, segments: Uint8Array, filtered: Uint8Array): void {
        // §15 and §20.6: each macroblock in raster order, its left edge, its inner vertical edges, its top edge and its
        // inner horizontal edges; the inner ones only when it has coefficients or is predicted by subblocks.
        for (let row: number = 0; row < frame.mbRows; row++) {
            for (let column: number = 0; column < frame.mbColumns; column++) {
                const index: number = row * frame.mbColumns + column;
                const [level, interior, hev]: readonly [number, number, number] = this.filterParameters(frame, yModes[index], segments[index]);
                if (level === 0) {
                    continue;
                }
                const luma: number = image.yOrigin + row * 16 * image.yStride + column * 16;
                const chroma: number = image.uvOrigin + row * 8 * image.uvStride + column * 8;
                const inner: boolean = filtered[index] === 1;
                if (frame.simple) {
                    this.simpleMacroblock(image.y, luma, image.yStride, level, interior, row, column, inner);
                } else {
                    this.normalMacroblock(image, luma, chroma, level, interior, hev, row, column, inner);
                }
            }
        }
    }

    private filterParameters(frame: Frame, yMode: number, segment: number): readonly [number, number, number] {
        // §15.4 and §20.6: the level with the segment and the deltas of the intra frame and of B_PRED, the interior limit
        // from the sharpness, and the high edge variance threshold of a key frame.
        let level: number = frame.level;
        if (frame.segmentation) {
            level = frame.absolute ? frame.segmentFilter[segment] : level + frame.segmentFilter[segment];
        }
        level = Math.min(63, Math.max(0, level));
        if (frame.deltas) {
            level += frame.referenceDelta[0];
            if (yMode === B_PRED) {
                level += frame.modeDelta[0];
            }
            level = Math.min(63, Math.max(0, level));
        }
        let interior: number = level;
        if (frame.sharpness > 0) {
            interior >>= frame.sharpness > 4 ? 2 : 1;
            interior = Math.min(interior, 9 - frame.sharpness);
        }
        interior = Math.max(1, interior);
        const hev: number = (level >= 15 ? 1 : 0) + (level >= 40 ? 1 : 0);
        return [level, interior, hev];
    }

    private normalMacroblock(image: LossyImage, luma: number, chroma: number, level: number, interior: number, hev: number, row: number, column: number, inner: boolean): void {
        const y: Uint8Array = image.y;
        const yStride: number = image.yStride;
        const uvStride: number = image.uvStride;
        if (column > 0) {
            this.edge(y, luma, 1, yStride, 16, level + 2, interior, hev, true);
            this.edge(image.u, chroma, 1, uvStride, 8, level + 2, interior, hev, true);
            this.edge(image.v, chroma, 1, uvStride, 8, level + 2, interior, hev, true);
        }
        if (inner) {
            for (let x: number = 4; x < 16; x += 4) {
                this.edge(y, luma + x, 1, yStride, 16, level, interior, hev, false);
            }
            this.edge(image.u, chroma + 4, 1, uvStride, 8, level, interior, hev, false);
            this.edge(image.v, chroma + 4, 1, uvStride, 8, level, interior, hev, false);
        }
        if (row > 0) {
            this.edge(y, luma, yStride, 1, 16, level + 2, interior, hev, true);
            this.edge(image.u, chroma, uvStride, 1, 8, level + 2, interior, hev, true);
            this.edge(image.v, chroma, uvStride, 1, 8, level + 2, interior, hev, true);
        }
        if (inner) {
            for (let line: number = 4; line < 16; line += 4) {
                this.edge(y, luma + line * yStride, yStride, 1, 16, level, interior, hev, false);
            }
            this.edge(image.u, chroma + 4 * uvStride, uvStride, 1, 8, level, interior, hev, false);
            this.edge(image.v, chroma + 4 * uvStride, uvStride, 1, 8, level, interior, hev, false);
        }
    }

    private edge(plane: Uint8Array, at: number, across: number, along: number, length: number, edgeLimit: number, interior: number, hev: number, macroblock: boolean): void {
        // §15.3: the normal filter, with the thresholds of the edge, the interior and the high edge variance; a
        // macroblock edge without high variance changes three pixels on each side, any other edge one or two.
        for (let step: number = 0; step < length; step++) {
            const q0: number = at + step * along;
            const p3: number = plane[q0 - 4 * across];
            const p2: number = plane[q0 - 3 * across];
            const p1: number = plane[q0 - 2 * across];
            const p0: number = plane[q0 - across];
            const r0: number = plane[q0];
            const r1: number = plane[q0 + across];
            const r2: number = plane[q0 + 2 * across];
            const r3: number = plane[q0 + 3 * across];
            if (Math.abs(p0 - r0) * 2 + (Math.abs(p1 - r1) >> 1) > 2 * edgeLimit + interior || Math.abs(p3 - p2) > interior || Math.abs(p2 - p1) > interior
                || Math.abs(p1 - p0) > interior || Math.abs(r3 - r2) > interior || Math.abs(r2 - r1) > interior || Math.abs(r1 - r0) > interior) {
                continue;
            }
            const variance: boolean = Math.abs(p1 - p0) > hev || Math.abs(r1 - r0) > hev;
            if (macroblock && !variance) {
                const w: number = this.signedByte(this.signedByte(p1 - r1) + 3 * (r0 - p0));
                let a: number = (27 * w + 63) >> 7;
                plane[q0 - across] = this.clamp(p0 + a);
                plane[q0] = this.clamp(r0 - a);
                a = (18 * w + 63) >> 7;
                plane[q0 - 2 * across] = this.clamp(p1 + a);
                plane[q0 + across] = this.clamp(r1 - a);
                a = (9 * w + 63) >> 7;
                plane[q0 - 3 * across] = this.clamp(p2 + a);
                plane[q0 + 2 * across] = this.clamp(r2 - a);
            } else {
                this.common(plane, q0, across, macroblock || variance);
            }
        }
    }

    private common(plane: Uint8Array, q0: number, across: number, outerTaps: boolean): void {
        const p1: number = plane[q0 - 2 * across];
        const p0: number = plane[q0 - across];
        const r0: number = plane[q0];
        const r1: number = plane[q0 + across];
        let a: number = 3 * (r0 - p0);
        if (outerTaps) {
            a += this.signedByte(p1 - r1);
        }
        a = this.signedByte(a);
        const f1: number = Math.min(127, a + 4) >> 3;
        const f2: number = Math.min(127, a + 3) >> 3;
        plane[q0 - across] = this.clamp(p0 + f2);
        plane[q0] = this.clamp(r0 - f1);
        if (!outerTaps) {
            const outer: number = (f1 + 1) >> 1;
            plane[q0 - 2 * across] = this.clamp(p1 + outer);
            plane[q0 + across] = this.clamp(r1 - outer);
        }
    }

    private simpleMacroblock(plane: Uint8Array, luma: number, stride: number, level: number, interior: number, row: number, column: number, inner: boolean): void {
        // §15.2: the simple filter, on luma only, with the limits of the macroblock and of the subblock edges.
        const macroblockLimit: number = (level + 2) * 2 + interior;
        const blockLimit: number = level * 2 + interior;
        if (column > 0) {
            this.simpleEdge(plane, luma, 1, stride, macroblockLimit);
        }
        if (inner) {
            for (let x: number = 4; x < 16; x += 4) {
                this.simpleEdge(plane, luma + x, 1, stride, blockLimit);
            }
        }
        if (row > 0) {
            this.simpleEdge(plane, luma, stride, 1, macroblockLimit);
        }
        if (inner) {
            for (let line: number = 4; line < 16; line += 4) {
                this.simpleEdge(plane, luma + line * stride, stride, 1, blockLimit);
            }
        }
    }

    private simpleEdge(plane: Uint8Array, at: number, across: number, along: number, limit: number): void {
        for (let step: number = 0; step < 16; step++) {
            const q0: number = at + step * along;
            if (Math.abs(plane[q0 - across] - plane[q0]) * 2 + (Math.abs(plane[q0 - 2 * across] - plane[q0 + across]) >> 1) <= limit) {
                this.common(plane, q0, across, true);
            }
        }
    }

    private signedByte(value: number): number {
        return value < -128 ? -128 : (value > 127 ? 127 : value);
    }
}
