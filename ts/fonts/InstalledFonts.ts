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

import type { Dirent } from "node:fs";
import { closeSync, openSync, readdirSync, readSync } from "node:fs";
import { extname, join } from "node:path";
import { FontFileReader } from "./FontFileReader.js";
import { NameTableReader } from "./NameTableReader.js";
import type { FontVariations, InstalledFace, SfntFont } from "./Typeface.js";
import { VariationReader } from "./VariationReader.js";

interface TableRecord {
    offset: number;
    length: number;
}

const FONT_EXTENSIONS: ReadonlySet<string> = new Set<string>([".ttf", ".otf", ".ttc", ".otc"]);
const INDEX_TABLES: ReadonlyArray<string> = ["name", "OS/2", "head", "maxp", "fvar"];

export class InstalledFonts {

    private readonly folders: ReadonlyArray<string>;
    private readonly diagnostics: Array<string>;
    private readonly variations: VariationReader = new VariationReader();
    private faces?: Array<InstalledFace>;

    constructor(folders: ReadonlyArray<string>, diagnostics: Array<string>) {
        this.folders = folders;
        this.diagnostics = diagnostics;
    }

    list(): ReadonlyArray<InstalledFace> {
        if (this.faces === undefined) {
            this.faces = [];
            const seen: Set<string> = new Set<string>();
            for (const folder of this.folders) {
                for (const path of this.filesIn(folder)) {
                    if (!seen.has(path)) {
                        seen.add(path);
                        this.faces.push(...this.facesOf(path));
                    }
                }
            }
        }
        return this.faces;
    }

    private filesIn(folder: string): Array<string> {
        const files: Array<string> = [];
        let entries: Array<Dirent>;
        try {
            entries = readdirSync(folder, { withFileTypes: true });
        } catch (error) {
            this.diagnostics.push("The font folder " + folder + " cannot be read: " + (error instanceof Error ? error.message : String(error)));
            return files;
        }
        entries.sort((first: Dirent, second: Dirent) => first.name < second.name ? -1 : (first.name > second.name ? 1 : 0));
        for (const entry of entries) {
            const path: string = join(folder, entry.name);
            if (entry.isDirectory()) {
                files.push(...this.filesIn(path));
            } else if (entry.isFile() && FONT_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
                files.push(path);
            }
        }
        return files;
    }

    private facesOf(path: string): Array<InstalledFace> {
        const faces: Array<InstalledFace> = [];
        let count: number;
        try {
            count = this.faceCount(path);
        } catch (error) {
            this.diagnostics.push("The font " + path + " in the font folder cannot be read: " + (error instanceof Error ? error.message : String(error)));
            return faces;
        }
        for (let index: number = 0; index < count; index++) {
            try {
                faces.push(this.face(path, index));
            } catch (error) {
                this.diagnostics.push("The face " + index + " of the font " + path + " in the font folder cannot be read: " + (error instanceof Error ? error.message : String(error)));
            }
        }
        return faces;
    }

    private face(path: string, index: number): InstalledFace {
        const tables: Readonly<Record<string, Buffer>> = this.tablesOf(path, index, INDEX_TABLES).tables;
        const os2: Buffer | undefined = tables["OS/2"];
        const head: Buffer | undefined = tables["head"];
        const maxp: Buffer | undefined = tables["maxp"];
        if (head === undefined || head.length < 54 || maxp === undefined || maxp.length < 6) {
            throw new Error("the font has no head or maxp table");
        }
        const names: NameTableReader = new NameTableReader(tables["name"]);
        const variations: FontVariations | undefined = this.variations.read(tables, names);
        const hasOs2: boolean = os2 !== undefined && os2.length >= 68;
        const face: InstalledFace = {
            path,
            index,
            names: names.names(),
            glyphCount: maxp.readUInt16BE(4),
            weightClass: hasOs2 ? (os2 as Buffer).readUInt16BE(4) : 400,
            widthClass: hasOs2 ? (os2 as Buffer).readUInt16BE(6) : 5,
            selection: hasOs2 ? (os2 as Buffer).readUInt16BE(62) : 0,
            macStyle: head.readUInt16BE(44)
        };
        if (variations !== undefined) {
            face.axes = variations.axes;
        }
        return face;
    }

    private faceCount(path: string): number {
        const handle: number = openSync(path, "r");
        try {
            const header: Buffer = this.read(handle, 0, 12);
            const signature: number = header.readUInt32BE(0);
            if (signature === FontFileReader.COLLECTION) {
                return header.readUInt32BE(8);
            }
            if (!FontFileReader.SFNT_VERSIONS.has(signature)) {
                throw new Error("the file is not an OpenType or TrueType font");
            }
            return 1;
        } finally {
            closeSync(handle);
        }
    }

    hasTable(face: InstalledFace, tag: string): boolean {
        try {
            return this.tablesOf(face.path, face.index, [tag]).tables[tag] !== undefined;
        } catch {
            return false;
        }
    }

    font(face: InstalledFace): SfntFont {
        // Only the face that is used is read: a collection holds many faces and can take tens of megabytes.
        const font: SfntFont = this.tablesOf(face.path, face.index);
        if (!FontFileReader.SFNT_VERSIONS.has(font.flavor)) {
            throw new Error("A font in the file has an unknown sfnt version");
        }
        return font;
    }

    private tablesOf(path: string, index: number, tags?: ReadonlyArray<string>): SfntFont {
        // Only the tables that are asked for are read, so that scanning hundreds of fonts stays fast; without a list, all.
        const handle: number = openSync(path, "r");
        try {
            const header: Buffer = this.read(handle, 0, 12);
            const offset: number = header.readUInt32BE(0) === FontFileReader.COLLECTION ? this.read(handle, 12 + index * 4, 4).readUInt32BE(0) : 0;
            const directory: Buffer = this.read(handle, offset, 12);
            const count: number = directory.readUInt16BE(4);
            const records: Buffer = this.read(handle, offset + 12, count * 16);
            const found: Map<string, TableRecord> = new Map<string, TableRecord>();
            for (let entry: number = 0; entry < count; entry++) {
                const tag: string = records.toString("latin1", entry * 16, entry * 16 + 4);
                if ((tags === undefined || tags.includes(tag)) && !found.has(tag)) {
                    found.set(tag, { offset: records.readUInt32BE(entry * 16 + 8), length: records.readUInt32BE(entry * 16 + 12) });
                }
            }
            const tables: Record<string, Buffer> = {};
            for (const [tag, record] of found) {
                tables[tag] = this.read(handle, record.offset, record.length);
            }
            return { flavor: directory.readUInt32BE(0), tables };
        } finally {
            closeSync(handle);
        }
    }

    private read(handle: number, position: number, length: number): Buffer {
        const buffer: Buffer = Buffer.alloc(length);
        if (readSync(handle, buffer, 0, length, position) !== length) {
            throw new Error("the file ends before its data does");
        }
        return buffer;
    }
}
