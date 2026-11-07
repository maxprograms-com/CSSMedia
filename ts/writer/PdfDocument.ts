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

import { PdfColorSpaces } from "./PdfColorSpaces.js";
import { PdfFile } from "./PdfFile.js";
import { PdfFonts } from "./PdfFonts.js";
import type { ImageResource, PageRectangle } from "./PdfPage.js";
import { PdfPage } from "./PdfPage.js";
import type { PatternResource } from "./PdfShadings.js";
import { PdfShadings } from "./PdfShadings.js";
import { PdfSyntax } from "./PdfSyntax.js";

interface DocumentMetadata {
    title?: string;
    authors?: ReadonlyArray<string>;
    subject?: string;
    keywords?: string;
    creator?: string;
}

interface OutlineItem {
    title: string;
    destination: string;
    open: boolean;
    object: number;
    children: Array<OutlineItem>;
}

const PRODUCER: string = "CSSMedia";
const PACKET_ID: string = "W5M0MpCehiHzreSzNTczkc9d";
const BYTE_ORDER_MARK: string = "\uFEFF";

export class PdfDocument {

    readonly file: PdfFile;
    readonly fonts: PdfFonts;
    readonly colors: PdfColorSpaces;
    readonly shadings: PdfShadings;
    private readonly syntax: PdfSyntax = new PdfSyntax();
    private pageTree: number;
    private readonly pages: Array<number> = [];
    private readonly destinations: Map<string, string> = new Map<string, string>();
    private readonly outline: Array<OutlineItem> = [];
    private readonly path: Array<OutlineItem> = [];
    private readonly created: Date = new Date();
    private metadata: DocumentMetadata = {};
    private language?: string;

    constructor(path: string) {
        this.file = new PdfFile(path);
        this.fonts = new PdfFonts(this.file);
        this.colors = new PdfColorSpaces(this.file);
        this.shadings = new PdfShadings(this.file);
        this.pageTree = this.file.reserve();
    }

    restart(): void {
        this.file.restart();
        this.pageTree = this.file.reserve();
        this.pages.length = 0;
        this.destinations.clear();
        this.outline.length = 0;
        this.path.length = 0;
        this.fonts.restart();
        this.colors.restart();
    }

    addPage(width: number, height: number): PdfPage {
        return new PdfPage(this.file.reserve(), width, height);
    }

    reserveForm(width: number, height: number): ImageResource {
        const object: number = this.file.reserve();
        return { key: "Fm" + object, object, width, height };
    }

    deferAnnotations(page: PdfPage): number {
        const array: number = this.file.reserve();
        page.deferAnnotations(array);
        return array;
    }

    annotationPage(object: number, width: number, height: number): PdfPage {
        return new PdfPage(object, width, height, false);
    }

    finishAnnotations(array: number, annotations: ReadonlyArray<number>): void {
        this.file.set(array, "[" + annotations.map((object: number) => this.syntax.reference(object)).join(" ") + "]");
    }

    hasDestination(name: string): boolean {
        return this.destinations.has(name);
    }

    finishPage(page: PdfPage): void {
        // ISO 32000-2 §7.7.3.3: the page object, written with its content stream as soon as the page is painted.
        const contents: number = this.file.addStream("", page.content.bytes(), true);
        this.file.set(page.object, page.dictionary(this.pageTree, contents));
        this.pages.push(page.object);
    }

    startForm(width: number, height: number, turned: boolean, reserved?: ImageResource): PdfPage {
        return new PdfPage(reserved?.object ?? this.file.reserve(), width, height, turned);
    }

    finishForm(form: PdfPage, box: readonly [number, number, number, number], matrix: ReadonlyArray<number>): ImageResource {
        // §8.10.1 and §11.6.6: a form XObject that is an isolated transparency group, blended in DeviceRGB.
        this.file.setStream(form.object, "/Type /XObject /Subtype /Form /BBox [" + this.syntax.numbers([box[0], box[1], box[0] + box[2], box[1] + box[3]])
            + "] /Matrix [" + this.syntax.numbers(matrix) + "] /Resources " + form.resources() + " /Group << /Type /Group /S /Transparency /I true /CS /DeviceRGB >>",
            form.content.bytes(), true);
        return { key: "Fm" + form.object, object: form.object, width: box[2], height: box[3] };
    }

    finishPattern(form: PdfPage, box: readonly [number, number, number, number], matrix: ReadonlyArray<number>): PatternResource {
        // §8.7.3.2: a colored tiling pattern whose cell is the box, repeated at its width and height.
        this.file.setStream(form.object, "/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [" + this.syntax.numbers([box[0], box[1], box[0] + box[2], box[1] + box[3]])
            + "] /XStep " + this.syntax.number(box[2]) + " /YStep " + this.syntax.number(box[3]) + " /Matrix [" + this.syntax.numbers(matrix) + "] /Resources "
            + form.resources(), form.content.bytes(), true);
        return { key: "P" + form.object, object: form.object };
    }

    linkToUri(page: PdfPage, area: PageRectangle, uri: string): void {
        // §12.5.6.5 and §12.6.4.8: a link annotation with a URI action; a Border of zero width draws nothing, and §12.5.2
        // exempts links from appearance streams.
        page.annotate(this.file.add("<< /Type /Annot /Subtype /Link /Rect " + page.rectangle(area) + " /Border [0 0 0] /A << /S /URI /URI "
            + this.syntax.asciiString(uri) + " >> >>"));
    }

    linkToDestination(page: PdfPage, area: PageRectangle, name: string): void {
        // §12.3.2.4: the destination named by a string, which the Dests name tree resolves.
        page.annotate(this.file.add("<< /Type /Annot /Subtype /Link /Rect " + page.rectangle(area) + " /Border [0 0 0] /Dest " + this.syntax.textString(name) + " >>"));
    }

    addDestination(name: string, page: PdfPage, x: number, y: number): void {
        // §12.3.2.2: [page /XYZ left top zoom], where a null zoom keeps the magnification of the reader.
        if (!this.destinations.has(name)) {
            this.destinations.set(name, "[" + this.syntax.reference(page.object) + " /XYZ " + this.syntax.numbers([x, page.height - y]) + " null]");
        }
    }

    addOutline(title: string, level: number, destination: string, open: boolean): void {
        // §12.3.3: the items of each level are a list under the item of the level above, so an item goes under the last
        // item of a lower level; a level that skips the ones between is placed one level below that item.
        const item: OutlineItem = { title, destination, open, object: this.file.reserve(), children: [] };
        while (this.path.length > 0 && this.path.length >= level) {
            this.path.pop();
        }
        const parent: OutlineItem | undefined = this.path[this.path.length - 1];
        (parent === undefined ? this.outline : parent.children).push(item);
        this.path.push(item);
    }

    setMetadata(metadata: DocumentMetadata): void {
        this.metadata = metadata;
    }

    setLanguage(language: string): void {
        this.language = language;
    }

    finish(): void {
        // §7.7.2, Table 29: the catalog with the page tree, the outline, the name dictionary with the destinations, the
        // metadata stream and the language; §7.7.3.2: one page tree node holds every page.
        this.fonts.finish();
        const catalog: number = this.file.reserve();
        this.file.set(this.pageTree, "<< /Type /Pages /Kids [" + this.pages.map((object: number) => this.syntax.reference(object)).join(" ") + "] /Count " + this.pages.length + " >>");
        let entries: string = "<< /Type /Catalog /Pages " + this.syntax.reference(this.pageTree);
        if (this.outline.length > 0) {
            entries += " /Outlines " + this.syntax.reference(this.writeOutline()) + " /PageMode /UseOutlines";
        }
        if (this.destinations.size > 0) {
            entries += " /Names << /Dests " + this.syntax.reference(this.writeDestinations()) + " >>";
        }
        entries += " /Metadata " + this.syntax.reference(this.writeMetadata());
        if (this.language !== undefined) {
            entries += " /Lang " + this.syntax.textString(this.language);
        }
        this.file.set(catalog, entries + " >>");
        this.file.finish(catalog);
    }

    abort(): void {
        this.file.discard();
    }

    private writeOutline(): number {
        // §12.3.3, Tables 150 and 151: Count is the number of visible items under an open item, and minus the number that
        // would be visible under a closed one; the outline dictionary counts every visible item.
        const object: number = this.file.reserve();
        this.writeItems(this.outline, object);
        const visible: number = this.outline.reduce((total: number, item: OutlineItem) => total + 1 + (item.open ? this.visible(item) : 0), 0);
        this.file.set(object, "<< /Type /Outlines /First " + this.syntax.reference(this.outline[0].object) + " /Last "
            + this.syntax.reference(this.outline[this.outline.length - 1].object) + " /Count " + visible + " >>");
        return object;
    }

    private writeItems(items: ReadonlyArray<OutlineItem>, parent: number): void {
        items.forEach((item: OutlineItem, index: number) => {
            let entries: string = "<< /Title " + this.syntax.textString(item.title) + " /Parent " + this.syntax.reference(parent);
            if (index > 0) {
                entries += " /Prev " + this.syntax.reference(items[index - 1].object);
            }
            if (index + 1 < items.length) {
                entries += " /Next " + this.syntax.reference(items[index + 1].object);
            }
            if (item.children.length > 0) {
                const count: number = this.visible(item);
                entries += " /First " + this.syntax.reference(item.children[0].object) + " /Last " + this.syntax.reference(item.children[item.children.length - 1].object)
                    + " /Count " + (item.open ? count : -count);
                this.writeItems(item.children, item.object);
            }
            this.file.set(item.object, entries + " /Dest " + this.syntax.textString(item.destination) + " >>");
        });
    }

    private visible(item: OutlineItem): number {
        let count: number = 0;
        for (const child of item.children) {
            count += 1 + (child.open ? this.visible(child) : 0);
        }
        return count;
    }

    private writeDestinations(): number {
        // §7.9.6: a name tree whose one node has the Names array, the keys sorted in the order of their bytes.
        const entries: Array<readonly [Buffer, string, string]> = [...this.destinations].map((entry: [string, string]): readonly [Buffer, string, string] =>
            [this.keyBytes(entry[0]), entry[0], entry[1]]);
        entries.sort((first: readonly [Buffer, string, string], second: readonly [Buffer, string, string]) => Buffer.compare(first[0], second[0]));
        const names: string = entries.map((entry: readonly [Buffer, string, string]) => this.syntax.textString(entry[1]) + " " + entry[2]).join(" ");
        return this.file.add("<< /Names [" + names + "] >>");
    }

    private keyBytes(text: string): Buffer {
        return /^[\x20-\x7E]*$/.test(text) ? Buffer.from(text, "latin1") : Buffer.concat([Buffer.from([0xFE, 0xFF]), Buffer.from(text, "utf16le").swap16()]);
    }

    private writeMetadata(): number {
        // §14.3.2: document metadata is an XMP packet (ISO 16684-1) in a stream of Type Metadata and Subtype XML, which
        // PDF 2.0 prefers to the deprecated document information dictionary (§14.3.3).
        const metadata: DocumentMetadata = this.metadata;
        const date: string = this.created.toISOString().replace(/\.\d+Z$/, "Z");
        let description: string = "<dc:format>application/pdf</dc:format>";
        if (metadata.title !== undefined) {
            description += "<dc:title><rdf:Alt><rdf:li xml:lang=\"x-default\">" + this.escape(metadata.title) + "</rdf:li></rdf:Alt></dc:title>";
        }
        if (metadata.authors !== undefined && metadata.authors.length > 0) {
            description += "<dc:creator><rdf:Seq>" + metadata.authors.map((author: string) => "<rdf:li>" + this.escape(author) + "</rdf:li>").join("") + "</rdf:Seq></dc:creator>";
        }
        if (metadata.subject !== undefined) {
            description += "<dc:description><rdf:Alt><rdf:li xml:lang=\"x-default\">" + this.escape(metadata.subject) + "</rdf:li></rdf:Alt></dc:description>";
        }
        if (metadata.keywords !== undefined) {
            description += "<pdf:Keywords>" + this.escape(metadata.keywords) + "</pdf:Keywords>";
        }
        if (metadata.creator !== undefined) {
            description += "<xmp:CreatorTool>" + this.escape(metadata.creator) + "</xmp:CreatorTool>";
        }
        description += "<pdf:Producer>" + PRODUCER + "</pdf:Producer><xmp:CreateDate>" + date + "</xmp:CreateDate><xmp:ModifyDate>" + date
            + "</xmp:ModifyDate><xmp:MetadataDate>" + date + "</xmp:MetadataDate>";
        const packet: string = "<?xpacket begin=\"" + BYTE_ORDER_MARK + "\" id=\"" + PACKET_ID + "\"?>\n<x:xmpmeta xmlns:x=\"adobe:ns:meta/\"><rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">"
            + "<rdf:Description rdf:about=\"\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:xmp=\"http://ns.adobe.com/xap/1.0/\" xmlns:pdf=\"http://ns.adobe.com/pdf/1.3/\">"
            + description + "</rdf:Description></rdf:RDF></x:xmpmeta>\n<?xpacket end=\"w\"?>";
        return this.file.addStream("/Type /Metadata /Subtype /XML", Buffer.from(packet, "utf8"), false);
    }

    private escape(text: string): string {
        return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }
}
