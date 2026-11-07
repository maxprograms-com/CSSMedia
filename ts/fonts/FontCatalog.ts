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

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { FontFaceRule, FontFaceSource } from "../css/Stylesheet.js";
import { RemoteResource } from "../net/RemoteResource.js";
import { BaseUrls } from "../pdf/BaseUrls.js";
import { CaseFolder } from "./CaseFolder.js";
import { FontFileReader } from "./FontFileReader.js";
import { InstalledFonts } from "./InstalledFonts.js";
import { NameTableReader } from "./NameTableReader.js";
import { StandardTypefaces } from "./StandardTypefaces.js";
import type { CatalogFace, InstalledFace, SfntFont, Typeface } from "./Typeface.js";
import { TypefaceReader } from "./TypefaceReader.js";

const STANDARD_GENERICS: Readonly<Record<string, string>> = { "serif": "Times", "sans-serif": "Helvetica", "monospace": "Courier", "math": "Times" };
const MATH_GENERIC: string = "math";
const MATH_TABLE: string = "MATH";

const POSTSCRIPT_EXCLUDED: string = "[](){}<>/%";
const POSTSCRIPT_MAXIMUM: number = 63;

export class FontCatalog {

    static readonly GENERIC_FAMILIES: ReadonlySet<string> = new Set<string>(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif",
        "ui-serif", "ui-monospace", "ui-rounded", "math", "emoji", "fangsong"]);

    private readonly installed?: InstalledFonts;
    private readonly declared: Map<string, Array<CatalogFace>> = new Map<string, Array<CatalogFace>>();
    private readonly typefaces: Map<CatalogFace, Typeface | null> = new Map<CatalogFace, Typeface | null>();
    private readonly files: Map<string, Array<SfntFont> | null> = new Map<string, Array<SfntFont> | null>();
    private readonly caseFolder: CaseFolder = new CaseFolder();
    private readonly fileReader: FontFileReader = new FontFileReader();
    private readonly typefaceReader: TypefaceReader = new TypefaceReader();
    private readonly standard: StandardTypefaces = new StandardTypefaces();
    private readonly remote: RemoteResource = new RemoteResource();
    private installedFamilies?: Map<string, Array<CatalogFace>>;
    private standardFamilies?: Map<string, Array<CatalogFace>>;
    private mathFamily?: string | null;
    private readonly common: FontCatalog;
    private readonly faces: Map<string, Typeface | null> = new Map<string, Typeface | null>();
    readonly diagnostics: Array<string>;

    constructor(fontFaces: ReadonlyArray<FontFaceRule>, fontFolder?: string, common?: FontCatalog) {
        // The installed fonts are those of the folder of the command line, never the fonts of the machine.
        this.common = common ?? this;
        this.diagnostics = common?.diagnostics ?? [];
        if (fontFolder !== undefined) {
            this.installed = new InstalledFonts([fontFolder], this.diagnostics);
        }
        for (const rule of fontFaces) {
            this.add(this.declared, this.caseFolder.fold(rule.family), { family: rule.family, origin: "font-face", rule });
        }
    }

    ofDocument(fontFaces: ReadonlyArray<FontFaceRule>): FontCatalog {
        // CSS Fonts 4 §4: @font-face rules define fonts "available for use within the documents that contain these rules", so
        // an image file has its own rules, and the standard and installed fonts that every document has.
        return new FontCatalog(fontFaces, undefined, this.common);
    }

    family(name: string): ReadonlyArray<CatalogFace> | undefined {
        // CSS Fonts 4 §4.2: a family declared by @font-face hides any other of the same name. The names of the standard
        // fonts of PDF mean those fonts, whose metrics do not depend on the system, before an installed family.
        const key: string = this.caseFolder.fold(name);
        return this.declared.get(key) ?? this.common.standardFamily(key) ?? this.common.installedFamily(key);
    }

    generic(keyword: string): ReadonlyArray<CatalogFace> | undefined {
        // CSS Fonts 4 §2.1.5: the user agent gives "reasonable default choices" that "express the characteristics of each family as
        // well as possible": a font with a MATH table for math, and otherwise the standard font of PDF that suits the family.
        const math: ReadonlyArray<CatalogFace> | undefined = keyword === MATH_GENERIC ? this.common.installedMath() : undefined;
        if (math !== undefined) {
            return math;
        }
        const standard: string | undefined = STANDARD_GENERICS[keyword];
        return standard === undefined ? undefined : this.common.standardFamily(this.caseFolder.fold(standard));
    }

    private installedMath(): ReadonlyArray<CatalogFace> | undefined {
        const installed: InstalledFonts | undefined = this.installed;
        if (installed === undefined) {
            return undefined;
        }
        if (this.mathFamily === undefined) {
            // InstalledFonts lists the faces in the order of the file names, so the same folder always gives the same font.
            const face: InstalledFace | undefined = installed.list().find((candidate: InstalledFace) => installed.hasTable(candidate, MATH_TABLE));
            this.mathFamily = face === undefined ? null : this.caseFolder.fold(face.names.family);
        }
        return this.mathFamily === null ? undefined : this.installedFamily(this.mathFamily);
    }

    typeface(face: CatalogFace): Typeface | undefined {
        if (face.origin !== "font-face" && this.common !== this) {
            return this.common.typeface(face);
        }
        let typeface: Typeface | null | undefined = this.typefaces.get(face);
        if (typeface === undefined) {
            if (face.origin === "standard") {
                typeface = this.standard.typeface(face.standard as string) ?? null;
            } else if (face.origin === "installed") {
                typeface = this.installedTypeface(face.installed as InstalledFace) ?? null;
            } else {
                typeface = this.declaredTypeface(face.rule as FontFaceRule) ?? null;
            }
            this.typefaces.set(face, typeface);
        }
        return typeface ?? undefined;
    }

    private add(map: Map<string, Array<CatalogFace>>, key: string, face: CatalogFace): void {
        const faces: Array<CatalogFace> | undefined = map.get(key);
        if (faces === undefined) {
            map.set(key, [face]);
        } else {
            faces.push(face);
        }
    }

    private installedFamily(key: string): ReadonlyArray<CatalogFace> | undefined {
        if (this.installed === undefined) {
            return undefined;
        }
        if (this.installedFamilies === undefined) {
            // CSS Fonts 4 §5.1: every localized family name of an installed font matches.
            const families: Map<string, Array<CatalogFace>> = new Map<string, Array<CatalogFace>>();
            for (const face of this.installed.list()) {
                const entry: CatalogFace = { family: face.names.family, origin: "installed", installed: face };
                const keys: Set<string> = new Set<string>(face.names.families.map((name: string) => this.caseFolder.fold(name)));
                for (const familyKey of keys) {
                    this.add(families, familyKey, entry);
                }
            }
            this.installedFamilies = families;
        }
        return this.installedFamilies.get(key);
    }

    private standardFamily(key: string): ReadonlyArray<CatalogFace> | undefined {
        // ISO 32000-1 §9.6.2: the standard 14 fonts, grouped by the family name their metrics give: Times, Helvetica,
        // Courier, Symbol and ZapfDingbats.
        if (this.standardFamilies === undefined) {
            this.standardFamilies = new Map<string, Array<CatalogFace>>();
            for (const name of this.standard.names()) {
                const family: string | undefined = this.standard.typeface(name)?.names.family;
                if (family !== undefined) {
                    this.add(this.standardFamilies, this.caseFolder.fold(family), { family, origin: "standard", standard: name });
                }
            }
        }
        return this.standardFamilies.get(key);
    }

    private installedTypeface(face: InstalledFace): Typeface | undefined {
        const installed: InstalledFonts | undefined = this.installed;
        // By its URL, so that the same file named by a @font-face rule is the same typeface and the PDF embeds it once.
        return installed === undefined ? undefined : this.face(pathToFileURL(resolve(face.path)).href, face.index, (): SfntFont => installed.font(face));
    }

    private declaredTypeface(rule: FontFaceRule): Typeface | undefined {
        // CSS Fonts 4 §4.3: the first source that can be activated; invalid data or a missing local face moves on to the next one.
        for (const source of rule.sources) {
            const typeface: Typeface | undefined = source.kind === "local" ? this.localTypeface(source) : this.urlTypeface(source);
            if (typeface !== undefined) {
                return typeface;
            }
        }
        this.diagnostics.push("No source of the @font-face rule for the family " + rule.family + " could be loaded, so the family has no face from that rule");
        return undefined;
    }

    private localTypeface(source: FontFaceSource): Typeface | undefined {
        // CSS Fonts 4 §4.3.3.1: local() matches the full name or the PostScript name of an installed face, never its family.
        const key: string = this.caseFolder.fold(source.location);
        const face: InstalledFace | undefined = this.common.installed?.list().find((candidate: InstalledFace) =>
            this.caseFolder.fold(candidate.names.fullName) === key || this.caseFolder.fold(candidate.names.postScriptName) === key);
        return face === undefined ? undefined : this.common.installedTypeface(face);
    }

    private urlTypeface(source: FontFaceSource): Typeface | undefined {
        const url: URL = new URL(source.location);
        const fragment: string = url.hash.length > 1 ? BaseUrls.percentDecoded(url.hash.substring(1)).toString("utf8") : "";
        url.hash = "";
        if (fragment.length > 0 && !this.validPostScriptName(fragment)) {
            return undefined;
        }
        const fonts: Array<SfntFont> | undefined = this.common.fontsOf(url.href, source.location);
        if (fonts === undefined) {
            return undefined;
        }
        let index: number = 0;
        if (fragment.length > 0) {
            // CSS Fonts 4 §4.3.2: with a fragment, only the face whose PostScript name is exactly the fragment may be used.
            index = fonts.findIndex((font: SfntFont) => new NameTableReader(font.tables["name"]).names().postScriptName === fragment);
            if (index < 0) {
                this.diagnostics.push("The font " + url.href + " has no face with the PostScript name " + fragment);
                return undefined;
            }
        }
        return this.common.face(url.href, index, (): SfntFont => fonts[index]);
    }

    private validPostScriptName(name: string): boolean {
        // RFC 8081 §4: printable ASCII other than the ten delimiters, at most 63 characters.
        if (name.length > POSTSCRIPT_MAXIMUM) {
            return false;
        }
        for (const character of name) {
            const code: number = character.codePointAt(0) as number;
            if (code < 0x21 || code > 0x7E || POSTSCRIPT_EXCLUDED.includes(character)) {
                return false;
            }
        }
        return true;
    }

    private fontsOf(location: string, description: string): Array<SfntFont> | undefined {
        let fonts: Array<SfntFont> | null | undefined = this.files.get(location);
        if (fonts === undefined) {
            fonts = null;
            const bytes: Buffer | undefined = this.bytes(location);
            if (bytes === undefined) {
                this.diagnostics.push("The font " + description + " was not found" + this.remote.failure(location));
            } else {
                try {
                    fonts = this.fileReader.read(bytes);
                } catch (error) {
                    this.diagnostics.push("The font " + description + " cannot be used: " + (error instanceof Error ? error.message : String(error)));
                }
            }
            this.files.set(location, fonts);
        }
        return fonts ?? undefined;
    }

    private bytes(location: string): Buffer | undefined {
        if (location.startsWith("file:")) {
            const path: string = fileURLToPath(location);
            return existsSync(path) ? readFileSync(path) : undefined;
        }
        return this.remote.retrieveBytes(location);
    }

    private face(source: string, index: number, font: () => SfntFont): Typeface | undefined {
        // One typeface for each face of a file, since the PDF has one font for a typeface and several documents can name it.
        const key: string = source + "#" + index;
        let typeface: Typeface | null | undefined = this.faces.get(key);
        if (typeface === undefined) {
            try {
                typeface = this.typefaceReader.read(font(), source, index);
            } catch (error) {
                this.diagnostics.push("The font " + source + " cannot be used: " + (error instanceof Error ? error.message : String(error)));
                typeface = null;
            }
            this.faces.set(key, typeface);
        }
        return typeface ?? undefined;
    }
}
