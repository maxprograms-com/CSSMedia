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

import { CharacterMapLookup } from "../CharacterMapLookup.js";
import type { Typeface } from "../Typeface.js";
import { GlyphDefinition } from "./GlyphDefinition.js";
import { LayoutTable } from "./LayoutTable.js";

export class FontLayout {

    private static readonly layouts: WeakMap<Typeface, FontLayout> = new WeakMap<Typeface, FontLayout>();

    readonly typeface: Typeface;
    readonly gsub?: LayoutTable;
    readonly gpos?: LayoutTable;
    readonly gdef?: GlyphDefinition;
    private readonly lookup: CharacterMapLookup = new CharacterMapLookup();

    private constructor(typeface: Typeface) {
        this.typeface = typeface;
        const gsub: LayoutTable | undefined = this.layoutTable(false, typeface.tables["GSUB"]);
        const gpos: LayoutTable | undefined = this.layoutTable(true, typeface.tables["GPOS"]);
        const gdef: GlyphDefinition | undefined = this.glyphDefinition(typeface.tables["GDEF"]);
        if (gsub !== undefined) {
            this.gsub = gsub;
        }
        if (gpos !== undefined) {
            this.gpos = gpos;
        }
        if (gdef !== undefined) {
            this.gdef = gdef;
        }
    }

    static of(typeface: Typeface): FontLayout {
        let layout: FontLayout | undefined = FontLayout.layouts.get(typeface);
        if (layout === undefined) {
            layout = new FontLayout(typeface);
            FontLayout.layouts.set(typeface, layout);
        }
        return layout;
    }

    glyphOf(codepoint: number): number {
        return this.lookup.glyphOf(this.typeface.characters, codepoint);
    }

    variantOf(codepoint: number, selector: number): number | undefined {
        return this.lookup.variantOf(this.typeface.characters, codepoint, selector);
    }

    private layoutTable(isPositioning: boolean, table?: Buffer): LayoutTable | undefined {
        // OpenType: a table whose major version is not recognized, or that cannot be read, is treated as missing.
        if (table === undefined || table.length < 10 || table.readUInt16BE(0) !== 1) {
            return undefined;
        }
        try {
            return new LayoutTable(table, isPositioning);
        } catch {
            return undefined;
        }
    }

    private glyphDefinition(table?: Buffer): GlyphDefinition | undefined {
        if (table === undefined || table.length < 12 || table.readUInt16BE(0) !== 1) {
            return undefined;
        }
        try {
            return new GlyphDefinition(table);
        } catch {
            return undefined;
        }
    }
}
