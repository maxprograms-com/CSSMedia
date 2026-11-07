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

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import type { ContentHandler, XMLDocument, XMLNode } from "typesxml";
import { Catalog, ProcessingInstruction, SAXParser, XMLElement } from "typesxml";
import type { ImageReader } from "../images/ImageFormats.js";
import { SourceDOMBuilder } from "./SourceDOMBuilder.js";
import { SourceElement } from "./SourceElement.js";
import { XmlRootHandler } from "./XmlRootHandler.js";

const READ_CHUNK: number = 1048576;

export class XmlTreeBuilder {

    private prefixes: ReadonlyMap<string, string> = new Map<string, string>();
    private instructions: ReadonlyArray<string> = [];

    buildFromFile(path: string, catalogFile?: string): SourceElement {
        const parser: SAXParser = new SAXParser();
        const builder: SourceDOMBuilder = new SourceDOMBuilder();
        parser.setContentHandler(builder);
        if (catalogFile) {
            const catalog: Catalog = new Catalog(catalogFile);
            parser.setCatalog(catalog);
        }
        parser.parseFile(path);
        return this.rootOf(builder);
    }

    buildFromImage(read: ImageReader, url: string): SourceElement {
        const builder: SourceDOMBuilder = new SourceDOMBuilder();
        this.parseImage(builder, read, url);
        const root: SourceElement = this.rootOf(builder);
        this.instructions = this.styleInstructions(builder.getDocument() as XMLDocument, root);
        return root;
    }

    private styleInstructions(document: XMLDocument, root: XMLElement): ReadonlyArray<string> {
        // Associating Style Sheets with XML Documents 1.0 puts the instructions "in the document's prolog".
        const found: Array<string> = [];
        for (const node of document.contentIterator() as IterableIterator<XMLNode>) {
            if (node === root) {
                break;
            }
            if (node instanceof ProcessingInstruction && node.getTarget() === "xml-stylesheet") {
                found.push(node.getData());
            }
        }
        return found;
    }

    getStyleInstructions(): ReadonlyArray<string> {
        return this.instructions;
    }

    private rootOf(builder: SourceDOMBuilder): SourceElement {
        const root: XMLElement | undefined = builder.getDocument()?.getRoot();
        if (!(root instanceof SourceElement)) {
            throw new Error("Error parsing XML document");
        }
        this.prefixes = builder.getPrefixes();
        return root;
    }

    getPrefixes(): ReadonlyMap<string, string> {
        return this.prefixes;
    }

    imageRoot(read: ImageReader, url: string): XmlRootHandler {
        const handler: XmlRootHandler = new XmlRootHandler();
        try {
            this.parseImage(handler, read, url);
        } catch {
            // The handler stops the parse by throwing at the document element; any other error leaves no root.
        }
        return handler;
    }

    parseImage(handler: ContentHandler, read: ImageReader, url: string): void {
        // SVG 2 §2.5.5: "SVG implementations must correctly support gzip-encoded" data streams, such as an .svgz file. A file that
        // is not compressed is parsed where it is, without reading it into memory first.
        const parser: SAXParser = new SAXParser();
        parser.setContentHandler(handler);
        if (url.startsWith("file:") && !this.compressed(read(0, 2))) {
            parser.parseFile(fileURLToPath(url));
            return;
        }
        const folder: string = mkdtempSync(join(tmpdir(), "cssmedia-"));
        try {
            const path: string = join(folder, "image.xml");
            const bytes: Buffer = this.whole(read);
            writeFileSync(path, this.compressed(bytes) ? gunzipSync(bytes) : bytes);
            parser.parseFile(path);
        } finally {
            rmSync(folder, { recursive: true, force: true });
        }
    }

    private compressed(data: Buffer): boolean {
        return data.length >= 2 && data[0] === 0x1F && data[1] === 0x8B;
    }

    private whole(read: ImageReader): Buffer {
        const chunks: Array<Buffer> = [];
        for (let position: number = 0; ;) {
            const chunk: Buffer = read(position, READ_CHUNK);
            chunks.push(chunk);
            position += chunk.length;
            if (chunk.length < READ_CHUNK) {
                return Buffer.concat(chunks);
            }
        }
    }
}
