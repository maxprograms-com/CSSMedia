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

export class ClassDefinition {

    private readonly startGlyph: number;
    private readonly classValues: Uint16Array;
    private readonly starts: Uint16Array;
    private readonly ends: Uint16Array;
    private readonly classes: Uint16Array;

    constructor(buffer: Buffer, offset: number) {
        const format: number = buffer.readUInt16BE(offset);
        this.startGlyph = 0;
        this.classValues = new Uint16Array(0);
        this.starts = new Uint16Array(0);
        this.ends = new Uint16Array(0);
        this.classes = new Uint16Array(0);
        if (format === 1) {
            this.startGlyph = buffer.readUInt16BE(offset + 2);
            const count: number = buffer.readUInt16BE(offset + 4);
            const values: Uint16Array = new Uint16Array(count);
            for (let index: number = 0; index < count; index++) {
                values[index] = buffer.readUInt16BE(offset + 6 + index * 2);
            }
            this.classValues = values;
        } else if (format === 2) {
            const count: number = buffer.readUInt16BE(offset + 2);
            const starts: Uint16Array = new Uint16Array(count);
            const ends: Uint16Array = new Uint16Array(count);
            const classes: Uint16Array = new Uint16Array(count);
            for (let index: number = 0; index < count; index++) {
                const record: number = offset + 4 + index * 6;
                starts[index] = buffer.readUInt16BE(record);
                ends[index] = buffer.readUInt16BE(record + 2);
                classes[index] = buffer.readUInt16BE(record + 4);
            }
            this.starts = starts;
            this.ends = ends;
            this.classes = classes;
        }
    }

    classOf(glyph: number): number {
        if (this.classValues.length > 0) {
            const index: number = glyph - this.startGlyph;
            return index >= 0 && index < this.classValues.length ? this.classValues[index] : 0;
        }
        let low: number = 0;
        let high: number = this.starts.length - 1;
        while (low <= high) {
            const middle: number = (low + high) >> 1;
            if (glyph < this.starts[middle]) {
                high = middle - 1;
            } else if (glyph > this.ends[middle]) {
                low = middle + 1;
            } else {
                return this.classes[middle];
            }
        }
        return 0;
    }

    isEmpty(): boolean {
        return this.classValues.length === 0 && this.starts.length === 0;
    }
}
