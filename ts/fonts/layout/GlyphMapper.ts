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

import type { FontLayout } from "./FontLayout.js";
import { GlyphDefinition } from "./GlyphDefinition.js";
import type { GlyphInfo } from "./GlyphInfo.js";

const DEFAULT_IGNORABLE: RegExp = /^\p{Default_Ignorable_Code_Point}$/u;
const MARK: RegExp = /^\p{M}$/u;
const NONSPACING_MARK: RegExp = /^[\p{Mn}\p{Me}]$/u;
const ZERO_WIDTH_JOINER: number = 0x200D;
const ZERO_WIDTH_NON_JOINER: number = 0x200C;

export class GlyphMapper {

    static readonly MASK_GLOBAL: number = 1;

    private readonly layout: FontLayout;

    constructor(layout: FontLayout) {
        this.layout = layout;
    }

    map(codepoints: ReadonlyArray<number>): Array<GlyphInfo> {
        // Each character takes its glyph from the character map; the class of the glyph comes from GDEF, or from the
        // character when the font has no glyph classes.
        const infos: Array<GlyphInfo> = [];
        const gdef: GlyphDefinition | undefined = this.layout.gdef;
        const classified: boolean = gdef !== undefined && gdef.hasGlyphClasses();
        let clusterBase: number = -1;
        for (let index: number = 0; index < codepoints.length; index++) {
            const codepoint: number = codepoints[index];
            const character: string = String.fromCodePoint(codepoint);
            const isMark: boolean = MARK.test(character);
            const previous: GlyphInfo | undefined = infos[infos.length - 1];
            const variant: number | undefined = previous !== undefined ? this.variantOf(previous.codepoint, codepoint) : undefined;
            if (variant !== undefined && previous !== undefined) {
                // OpenType cmap format 14: a variation sequence that the font lists has one glyph for the character and its
                // selector.
                previous.glyph = variant;
                previous.glyphClass = classified ? (gdef as GlyphDefinition).glyphClassOf(variant) : previous.glyphClass;
                continue;
            }
            if (isMark && previous !== undefined && !previous.ignorable) {
                // A base and a mark that the font has as one precomposed character use that glyph.
                const composed: string = String.fromCodePoint(previous.codepoint, codepoint).normalize("NFC");
                const composedCodepoint: number = composed.codePointAt(0) as number;
                const single: boolean = composed.length === String.fromCodePoint(composedCodepoint).length;
                const composedGlyph: number = single ? this.layout.glyphOf(composedCodepoint) : 0;
                if (composedGlyph !== 0 && composedCodepoint !== previous.codepoint) {
                    previous.glyph = composedGlyph;
                    previous.codepoint = composedCodepoint;
                    continue;
                }
            }
            const glyph: number = this.layout.glyphOf(codepoint);
            let glyphClass: number = classified ? (gdef as GlyphDefinition).glyphClassOf(glyph) : (NONSPACING_MARK.test(character) ? GlyphDefinition.MARK : GlyphDefinition.BASE);
            const ignorable: boolean = DEFAULT_IGNORABLE.test(character);
            if (ignorable && !classified) {
                glyphClass = GlyphDefinition.BASE;
            }
            if (!ignorable && (!isMark || clusterBase < 0)) {
                clusterBase = index;
            }
            infos.push({
                glyph, cluster: isMark && !ignorable ? clusterBase : index, codepoint, mask: GlyphMapper.MASK_GLOBAL, xAdvance: 0, xOffset: 0, yOffset: 0, glyphClass,
                ligatureId: 0, ligatureComponent: 0, ligatureComponents: 1, attachment: 0, attachmentKind: 0, ignorable,
                joiner: codepoint === ZERO_WIDTH_JOINER, nonJoiner: codepoint === ZERO_WIDTH_NON_JOINER, category: 0, substituted: false
            });
        }
        return infos;
    }

    private variantOf(codepoint: number, selector?: number): number | undefined {
        if (selector === undefined || !((selector >= 0xFE00 && selector <= 0xFE0F) || (selector >= 0xE0100 && selector <= 0xE01EF))) {
            return undefined;
        }
        return this.layout.variantOf(codepoint, selector);
    }

    single(codepoint: number, cluster: number, category: number, next?: number): GlyphInfo {
        // A script engine that forms its own clusters maps each character by itself and gives it the cluster and its class.
        // With the character after it, a variation selector of a sequence that the font lists gives the glyph of the sequence.
        const gdef: GlyphDefinition | undefined = this.layout.gdef;
        const character: string = String.fromCodePoint(codepoint);
        const glyph: number = this.variantOf(codepoint, next) ?? this.layout.glyphOf(codepoint);
        const ignorable: boolean = DEFAULT_IGNORABLE.test(character);
        const glyphClass: number = gdef !== undefined && gdef.hasGlyphClasses() ? gdef.glyphClassOf(glyph)
            : (NONSPACING_MARK.test(character) && !ignorable ? GlyphDefinition.MARK : GlyphDefinition.BASE);
        return {
            glyph, cluster, codepoint, mask: GlyphMapper.MASK_GLOBAL, xAdvance: 0, xOffset: 0, yOffset: 0, glyphClass,
            ligatureId: 0, ligatureComponent: 0, ligatureComponents: 1, attachment: 0, attachmentKind: 0, ignorable,
            joiner: codepoint === ZERO_WIDTH_JOINER, nonJoiner: codepoint === ZERO_WIDTH_NON_JOINER, category, substituted: false
        };
    }
}
