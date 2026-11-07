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

import type { ItemVariationStore } from "../Typeface.js";
import { VariationReader } from "../VariationReader.js";
import { ClassDefinition } from "./ClassDefinition.js";
import { Coverage } from "./Coverage.js";

export class GlyphDefinition {

    static readonly BASE: number = 1;
    static readonly LIGATURE: number = 2;
    static readonly MARK: number = 3;

    readonly variationStore?: ItemVariationStore;
    private readonly glyphClasses?: ClassDefinition;
    private readonly markAttachClasses?: ClassDefinition;
    private readonly markGlyphSets: Array<Coverage> = [];

    constructor(buffer: Buffer) {
        // OpenType GDEF header: version 1.2 adds the mark glyph sets and version 1.3 the item variation store that the
        // VariationIndex tables of GPOS refer to.
        const minorVersion: number = buffer.readUInt16BE(2);
        const glyphClassOffset: number = buffer.readUInt16BE(4);
        const markAttachOffset: number = buffer.readUInt16BE(10);
        if (glyphClassOffset !== 0) {
            this.glyphClasses = new ClassDefinition(buffer, glyphClassOffset);
        }
        if (markAttachOffset !== 0) {
            this.markAttachClasses = new ClassDefinition(buffer, markAttachOffset);
        }
        const setsOffset: number = minorVersion >= 2 ? buffer.readUInt16BE(12) : 0;
        if (setsOffset !== 0) {
            const count: number = buffer.readUInt16BE(setsOffset + 2);
            for (let index: number = 0; index < count; index++) {
                this.markGlyphSets.push(new Coverage(buffer, setsOffset + buffer.readUInt32BE(setsOffset + 4 + index * 4)));
            }
        }
        const storeOffset: number = minorVersion >= 3 ? buffer.readUInt32BE(14) : 0;
        if (storeOffset !== 0) {
            this.variationStore = new VariationReader().store(buffer, storeOffset);
        }
    }

    hasGlyphClasses(): boolean {
        return this.glyphClasses !== undefined && !this.glyphClasses.isEmpty();
    }

    glyphClassOf(glyph: number): number {
        return this.glyphClasses === undefined ? 0 : this.glyphClasses.classOf(glyph);
    }

    markAttachClassOf(glyph: number): number {
        return this.markAttachClasses === undefined ? 0 : this.markAttachClasses.classOf(glyph);
    }

    inMarkGlyphSet(setIndex: number, glyph: number): boolean {
        const set: Coverage | undefined = this.markGlyphSets[setIndex];
        return set !== undefined && set.contains(glyph);
    }
}
