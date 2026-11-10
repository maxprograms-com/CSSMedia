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

import { createHash } from "node:crypto";
import type { FontInstance, Typeface } from "../fonts/Typeface.js";
import { EmbeddedPdfFont } from "./EmbeddedPdfFont.js";
import type { PdfFile } from "./PdfFile.js";
import type { PdfFont } from "./PdfFont.js";
import { StandardPdfFont } from "./StandardPdfFont.js";

const TAG_LENGTH: number = 6;
const LETTERS: number = 26;
const TAG_COUNT: number = LETTERS ** TAG_LENGTH;

export class PdfFonts {

    private readonly file: PdfFile;
    private readonly fonts: Map<string, PdfFont> = new Map<string, PdfFont>();
    private readonly typefaces: Map<Typeface, number> = new Map<Typeface, number>();
    private readonly tags: Set<string> = new Set<string>();

    constructor(file: PdfFile) {
        this.file = file;
    }

    font(instance: FontInstance, vertical: boolean): PdfFont {
        // One PDF font for each typeface, variation instance, synthesized bold face and writing direction; a standard font has
        // no vertical metrics in PDF, so its upright glyphs are turned by whoever paints them.
        const standard: boolean = instance.typeface.standardFont !== undefined;
        let identity: number | undefined = this.typefaces.get(instance.typeface);
        if (identity === undefined) {
            identity = this.typefaces.size;
            this.typefaces.set(instance.typeface, identity);
        }
        const key: string = identity + "|" + Array.from(instance.coordinates).join(",") + "|" + (instance.emboldening ?? 0) + (vertical && !standard ? "|V" : "|H");
        let font: PdfFont | undefined = this.fonts.get(key);
        if (font === undefined) {
            font = standard ? new StandardPdfFont(this.file, instance) : new EmbeddedPdfFont(this.file, instance, vertical, this.tag(key + instance.typeface.source));
            this.fonts.set(key, font);
        }
        return font;
    }

    finish(): void {
        for (const font of this.fonts.values()) {
            font.write();
        }
    }

    restart(): void {
        this.fonts.clear();
        this.typefaces.clear();
        this.tags.clear();
    }

    private tag(seed: string): string {
        // ISO 32000-2 §9.9.2: "exactly six uppercase letters", different for "different subsets of the same font"; a tag in
        // use is followed by the next one, so the tags are tried in turn until a free one.
        let value: number = createHash("md5").update(seed).digest().readUInt32BE(0) % TAG_COUNT;
        let tag: string = this.tagText(value);
        while (this.tags.has(tag)) {
            value = (value + 1) % TAG_COUNT;
            tag = this.tagText(value);
        }
        this.tags.add(tag);
        return tag;
    }

    private tagText(value: number): string {
        let tag: string = "";
        let rest: number = value;
        for (let index: number = 0; index < TAG_LENGTH; index++) {
            tag += String.fromCharCode(65 + rest % LETTERS);
            rest = Math.floor(rest / LETTERS);
        }
        return tag;
    }
}
