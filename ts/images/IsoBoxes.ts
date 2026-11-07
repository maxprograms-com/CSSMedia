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

import type { ImageReader } from "./ImageFormats.js";

export type IsoBox = readonly [string, number, number];

export class IsoBoxes {

    children(read: ImageReader, start: number, end: number): Array<IsoBox> {
        // ISO/IEC 14496-12 §4.2: a box is a 32-bit size and a four-character type; the size 1 is followed by a 64-bit size,
        // and a box with the size 0 is the last one and reaches the end of the file.
        const found: Array<IsoBox> = [];
        for (let position: number = start; position < end;) {
            const header: Buffer = read(position, 16);
            if (header.length < 8) {
                break;
            }
            const large: boolean = header.readUInt32BE(0) === 1 && header.length === 16;
            const size: number = large ? Number(header.readBigUInt64BE(8)) : header.readUInt32BE(0);
            const body: number = position + (large ? 16 : 8);
            if (size !== 0 && position + size < body) {
                break;
            }
            const next: number = size === 0 ? end : Math.min(end, position + size);
            found.push([header.toString("latin1", 4, 8), body, next]);
            position = next;
        }
        return found;
    }
}
