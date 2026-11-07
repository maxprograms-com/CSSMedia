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

import type { GlyphInfo } from "./GlyphInfo.js";
import { ATTACH_CURSIVE } from "./GlyphInfo.js";

export class AttachmentResolver {

    resolve(infos: Array<GlyphInfo>, rtl: boolean, vertical: boolean): void {
        // An attached glyph was placed relative to the origin of the glyph it attaches to; its offset becomes relative to its
        // own pen position by taking the offset of that glyph, vertical origin included, and the advances between the two.
        const done: Array<boolean> = new Array<boolean>(infos.length).fill(false);
        for (let index: number = 0; index < infos.length; index++) {
            this.propagate(infos, index, rtl, vertical, done);
        }
    }

    private propagate(infos: Array<GlyphInfo>, index: number, rtl: boolean, vertical: boolean, done: Array<boolean>): void {
        if (done[index]) {
            return;
        }
        done[index] = true;
        const info: GlyphInfo = infos[index];
        if (info.attachmentKind === 0 || info.attachment === 0) {
            return;
        }
        const parent: number = index + info.attachment;
        if (parent < 0 || parent >= infos.length) {
            return;
        }
        this.propagate(infos, parent, rtl, vertical, done);
        const base: GlyphInfo = infos[parent];
        if (info.attachmentKind === ATTACH_CURSIVE) {
            if (vertical) {
                info.xOffset += base.xOffset;
            } else {
                info.yOffset += base.yOffset;
            }
            return;
        }
        info.xOffset += base.xOffset;
        info.yOffset += base.yOffset;
        // Only a backwards 'kerx' subtable attaches a glyph to one that comes after it, which the second loops are for.
        if (vertical) {
            for (let between: number = parent; between < index; between++) {
                info.yOffset += infos[between].xAdvance;
            }
            for (let between: number = index; between < parent; between++) {
                info.yOffset -= infos[between].xAdvance;
            }
        } else if (!rtl) {
            for (let between: number = parent; between < index; between++) {
                info.xOffset -= infos[between].xAdvance;
            }
            for (let between: number = index; between < parent; between++) {
                info.xOffset += infos[between].xAdvance;
            }
        } else {
            for (let between: number = parent + 1; between <= index; between++) {
                info.xOffset += infos[between].xAdvance;
            }
            for (let between: number = index + 1; between <= parent; between++) {
                info.xOffset -= infos[between].xAdvance;
            }
        }
    }
}
