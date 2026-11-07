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

import type { Hash } from "node:crypto";
import { createHash } from "node:crypto";
import { closeSync, ftruncateSync, mkdirSync, openSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { deflateSync } from "node:zlib";
import { PdfSyntax } from "./PdfSyntax.js";

const HEADER: Buffer = Buffer.concat([Buffer.from("%PDF-2.0\n", "latin1"), Buffer.from([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A])]);
const UNWRITTEN: number = -1;

export class PdfFile {

    private readonly path: string;
    private readonly unfinished: string;
    private readonly descriptor: number;
    private readonly offsets: Array<number> = [0];
    private readonly syntax: PdfSyntax = new PdfSyntax();
    private hash: Hash = createHash("md5");
    private position: number = 0;
    private open: boolean = true;
    private hashing: boolean = true;

    constructor(path: string) {
        // Each object goes to the file as soon as it is complete, so that a large document is never held in memory whole.
        // ISO 32000-2 §7.5.2: the header names version 2.0, and a comment of four binary bytes follows it.
        mkdirSync(dirname(path), { recursive: true });
        this.path = path;
        // A PDF from an earlier run may be at the path, and a run that stops has nothing to replace it with.
        this.unfinished = path + "." + process.pid + ".tmp";
        this.descriptor = openSync(this.unfinished, "w");
        this.write(HEADER);
    }

    restart(): void {
        ftruncateSync(this.descriptor, 0);
        this.offsets.length = 1;
        this.position = 0;
        this.hash = createHash("md5");
        this.hashing = true;
        this.write(HEADER);
    }

    reserve(): number {
        this.offsets.push(UNWRITTEN);
        return this.offsets.length - 1;
    }

    set(object: number, body: string | Uint8Array): void {
        // §7.3.10: "obj" and "endobj" around the object; §7.5.4: the cross-reference entry gives where "obj" starts.
        if (this.offsets[object] !== UNWRITTEN) {
            throw new Error("PDF object " + object + " is written twice");
        }
        this.offsets[object] = this.position;
        this.write(Buffer.from(object + " 0 obj\n", "latin1"));
        this.write(typeof body === "string" ? Buffer.from(body, "latin1") : body);
        this.write(Buffer.from("\nendobj\n", "latin1"));
    }

    add(body: string | Uint8Array): number {
        const object: number = this.reserve();
        this.set(object, body);
        return object;
    }

    setStream(object: number, entries: string, data: Uint8Array, compress: boolean): void {
        // §7.3.8: the stream keyword is followed by a line feed, Length counts the bytes of the encoded data, and the end of
        // line before endstream is not part of them.
        const payload: Uint8Array = compress ? deflateSync(data) : data;
        const dictionary: string = "<<" + (entries.length > 0 ? " " + entries : "") + " /Length " + payload.length + (compress ? " /Filter /FlateDecode" : "") + " >>\nstream\n";
        this.set(object, Buffer.concat([Buffer.from(dictionary, "latin1"), payload, Buffer.from("\nendstream", "latin1")]));
    }

    addStream(entries: string, data: Uint8Array, compress: boolean): number {
        const object: number = this.reserve();
        this.setStream(object, entries, data, compress);
        return object;
    }

    finish(catalog: number): void {
        // §7.5.4: one subsection from object 0, entries of exactly 20 bytes ending in SPACE LINE FEED; §7.5.5: the trailer,
        // with the ID that PDF 2.0 requires, startxref and %%EOF; §14.4: the identifier comes from the contents.
        const missing: number = this.offsets.indexOf(UNWRITTEN);
        if (missing >= 0) {
            throw new Error("PDF object " + missing + " was reserved but never written");
        }
        const identifier: string = this.syntax.hex(this.hash.digest());
        this.hashing = false;
        const start: number = this.position;
        let table: string = "xref\n0 " + this.offsets.length + "\n0000000000 65535 f \n";
        for (let object: number = 1; object < this.offsets.length; object++) {
            table += String(this.offsets[object]).padStart(10, "0") + " 00000 n \n";
        }
        table += "trailer\n<< /Size " + this.offsets.length + " /Root " + this.syntax.reference(catalog) + " /ID [" + identifier + " " + identifier + "] >>\nstartxref\n"
            + start + "\n%%EOF\n";
        this.write(Buffer.from(table, "latin1"));
        this.close();
        renameSync(this.unfinished, this.path);
    }

    discard(): void {
        this.close();
        unlinkSync(this.unfinished);
    }

    private close(): void {
        if (this.open) {
            this.open = false;
            closeSync(this.descriptor);
        }
    }

    private write(bytes: Uint8Array): void {
        if (this.hashing) {
            this.hash.update(bytes);
        }
        let written: number = 0;
        while (written < bytes.length) {
            written += writeSync(this.descriptor, bytes, written, bytes.length - written, this.position + written);
        }
        this.position += bytes.length;
    }
}
