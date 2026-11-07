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

import type { ColorSpaceResource } from "../writer/PdfColorSpaces.js";
import type { ImageResource } from "../writer/PdfPage.js";
import type { ImageAlpha, ImageFormat, ImageFormats, ImageReader, ImageRequest, ImageSamples, ImageSize } from "./ImageFormats.js";
import type { IsoBox } from "./IsoBoxes.js";
import { IsoBoxes } from "./IsoBoxes.js";

interface ItemSize {
    width?: number;
    height?: number;
    cropped: boolean;
    turned: boolean;
}

const HEIF_BRANDS: ReadonlySet<string> = new Set<string>(["mif1", "msf1", "miaf", "avif", "avis"]);
const AV1_BRANDS: ReadonlySet<string> = new Set<string>(["avif", "avis"]);
const BRAND_LIMIT: number = 256;
const ASSOCIATIONS_LIMIT: number = 1048576;

export class HeifImage implements ImageFormat {

    private readonly images: ImageFormats;
    private readonly boxes: IsoBoxes = new IsoBoxes();
    private readonly kinds: Map<string, string> = new Map<string, string>();

    constructor(images: ImageFormats) {
        this.images = images;
    }

    static accepts(read: ImageReader): boolean {
        // AV1 Image File Format §7: "The file shall list 'avif' or 'avis' in the FileTypeBox", and 'miaf'.
        return HeifImage.brands(read).some((brand: string) => HEIF_BRANDS.has(brand));
    }

    size(read: ImageReader): ImageSize | undefined {
        // meta is a full box, whose version and flags come before its children.
        const meta: IsoBox | undefined = this.boxes.children(read, 0, Number.MAX_SAFE_INTEGER).find((box: IsoBox) => box[0] === "meta");
        return meta === undefined ? undefined : this.primaryItem(read, meta[1] + 4, meta[2]);
    }

    key(): string {
        return "";
    }

    draw(request: ImageRequest): ImageResource | undefined {
        throw this.images.missing(request.href, this.decoding(request.href, request.data));
    }

    samples(href: string, data: Buffer): readonly [ImageSamples, ColorSpaceResource] | undefined {
        throw this.images.missing(href, this.decoding(href, data));
    }

    alpha(href: string, data: Buffer): ImageAlpha | undefined {
        throw this.images.missing(href, this.decoding(href, data));
    }

    private decoding(href: string, data: Buffer): string {
        const known: string | undefined = this.kinds.get(href);
        if (known !== undefined) {
            return known;
        }
        const brands: Array<string> = HeifImage.brands((position: number, length: number) => data.subarray(position, position + length));
        const kind: string = brands.some((brand: string) => AV1_BRANDS.has(brand)) ? "AVIF decoding" : "HEIF decoding";
        this.kinds.set(href, kind);
        return kind;
    }

    private static brands(read: ImageReader): Array<string> {
        // ISO/IEC 14496-12, FileTypeBox: a GeneralTypeBox, with the major brand, the minor version and the compatible brands.
        const head: Buffer = read(0, 8);
        if (head.length < 8 || head.toString("latin1", 4, 8) !== "ftyp") {
            return [];
        }
        const size: number = Math.min(head.readUInt32BE(0), BRAND_LIMIT);
        const body: Buffer = read(8, size - 8);
        const brands: Array<string> = body.length >= 4 ? [body.toString("latin1", 0, 4)] : [];
        for (let offset: number = 8; offset + 4 <= body.length; offset += 4) {
            brands.push(body.toString("latin1", offset, offset + 4));
        }
        return brands;
    }

    private primaryItem(read: ImageReader, start: number, end: number): ImageSize | undefined {
        // ISO/IEC 14496-12, PrimaryItemBox: the item identifier has 16 bits in version 0 and 32 after it. ItemPropertiesBox:
        // one ipco with the properties, and any number of ipma boxes that give the items their properties.
        let primary: number | undefined;
        let properties: Array<IsoBox> = [];
        const associations: Array<IsoBox> = [];
        const size: ItemSize = { cropped: false, turned: false };
        for (const box of this.boxes.children(read, start, end)) {
            if (box[0] === "pitm") {
                const fields: Buffer = read(box[1], 8);
                if (fields.length >= 6 && fields[0] === 0) {
                    primary = fields.readUInt16BE(4);
                } else if (fields.length === 8) {
                    primary = fields.readUInt32BE(4);
                }
            } else if (box[0] === "iprp") {
                for (const child of this.boxes.children(read, box[1], box[2])) {
                    properties = child[0] === "ipco" ? this.boxes.children(read, child[1], child[2]) : properties;
                    if (child[0] === "ipma") {
                        associations.push(child);
                    }
                }
            }
        }
        for (const box of associations) {
            if (primary !== undefined) {
                this.itemProperties(read, box, primary, properties, size);
            }
        }
        // The transformative properties are part of the image and not orientation metadata, so the size is already turned.
        return this.images.rasterSize(false, size.turned ? size.height : size.width, size.turned ? size.width : size.height);
    }

    private itemProperties(read: ImageReader, box: IsoBox, primary: number, properties: ReadonlyArray<IsoBox>, size: ItemSize): void {
        // ISO/IEC 14496-12, ItemPropertyAssociationBox: the item identifiers have 32 bits from version 1; an association is
        // the essential bit and a property index, of 15 bits when the first flag is set and of 7 otherwise, counted from 1.
        const data: Buffer = read(box[1], Math.min(box[2] - box[1], ASSOCIATIONS_LIMIT));
        if (data.length < 8) {
            return;
        }
        const wide: boolean = data[0] !== 0;
        const long: boolean = (data[3] & 1) !== 0;
        const entries: number = data.readUInt32BE(4);
        let offset: number = 8;
        for (let entry: number = 0; entry < entries && offset + (wide ? 5 : 3) <= data.length; entry++) {
            const item: number = wide ? data.readUInt32BE(offset) : data.readUInt16BE(offset);
            const count: number = data[offset + (wide ? 4 : 2)];
            offset += wide ? 5 : 3;
            for (let association: number = 0; association < count && offset + (long ? 2 : 1) <= data.length; association++) {
                const index: number = long ? data.readUInt16BE(offset) & 0x7FFF : data[offset] & 0x7F;
                offset += long ? 2 : 1;
                const property: IsoBox | undefined = item === primary && index > 0 ? properties[index - 1] : undefined;
                if (property === undefined) {
                    continue;
                }
                // ISO/IEC 23008-12: ispe is a full property with the width and the height; clap and irot are transformative:
                // clap has the clean aperture as fractions, and irot the angle, in quarter turns, in its two lowest bits. The size of
                // ispe comes before them wherever it is listed; a crop is of the image as turned so far, so it starts unturned.
                const fields: Buffer = read(property[1], 16);
                if (property[0] === "ispe" && fields.length >= 12 && !size.cropped) {
                    size.width = fields.readUInt32BE(4);
                    size.height = fields.readUInt32BE(8);
                } else if (property[0] === "clap" && fields.length === 16 && fields.readUInt32BE(4) > 0 && fields.readUInt32BE(12) > 0) {
                    size.width = fields.readUInt32BE(0) / fields.readUInt32BE(4);
                    size.height = fields.readUInt32BE(8) / fields.readUInt32BE(12);
                    size.cropped = true;
                    size.turned = false;
                } else if (property[0] === "irot" && fields.length >= 1 && (fields[0] & 1) === 1) {
                    size.turned = !size.turned;
                }
            }
        }
    }
}
