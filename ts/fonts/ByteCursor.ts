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

export class ByteCursor {

    readonly data: Buffer;
    position: number;
    readonly end: number;

    constructor(data: Buffer, start: number, end: number) {
        if (start < 0 || end > data.length || start > end) {
            throw new Error("A font data block lies outside the file");
        }
        this.data = data;
        this.position = start;
        this.end = end;
    }

    uint8(): number {
        this.require(1);
        const value: number = this.data[this.position];
        this.position += 1;
        return value;
    }

    int8(): number {
        this.require(1);
        const value: number = this.data.readInt8(this.position);
        this.position += 1;
        return value;
    }

    uint16(): number {
        this.require(2);
        const value: number = this.data.readUInt16BE(this.position);
        this.position += 2;
        return value;
    }

    int16(): number {
        this.require(2);
        const value: number = this.data.readInt16BE(this.position);
        this.position += 2;
        return value;
    }

    uint32(): number {
        this.require(4);
        const value: number = this.data.readUInt32BE(this.position);
        this.position += 4;
        return value;
    }

    tag(): string {
        this.require(4);
        const value: string = this.data.toString("latin1", this.position, this.position + 4);
        this.position += 4;
        return value;
    }

    bytes(length: number): Buffer {
        this.require(length);
        const value: Buffer = this.data.subarray(this.position, this.position + length);
        this.position += length;
        return value;
    }

    skip(length: number): void {
        this.require(length);
        this.position += length;
    }

    uintBase128(): number {
        // WOFF2 §3.1: no leading zero byte, at most five bytes, and no overflow past 2^32 - 1.
        let value: number = 0;
        for (let index: number = 0; index < 5; index++) {
            const byte: number = this.uint8();
            if (index === 0 && byte === 0x80) {
                throw new Error("A UIntBase128 value has a leading zero");
            }
            if (value > 0x1FFFFFF) {
                throw new Error("A UIntBase128 value exceeds 32 bits");
            }
            value = value * 128 + (byte & 0x7F);
            if ((byte & 0x80) === 0) {
                return value;
            }
        }
        throw new Error("A UIntBase128 value is longer than five bytes");
    }

    uint255(): number {
        const code: number = this.uint8();
        if (code === 253) {
            return this.uint16();
        }
        if (code === 255) {
            return this.uint8() + 253;
        }
        if (code === 254) {
            return this.uint8() + 506;
        }
        return code;
    }

    private require(length: number): void {
        if (this.position + length > this.end) {
            throw new Error("A font table ends before its data does");
        }
    }
}
