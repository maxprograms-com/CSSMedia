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

import { closeSync, openSync, readFileSync, readSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RemoteResource } from "../net/RemoteResource.js";
import type { SourceElement } from "../parse/SourceElement.js";
import { BaseUrls } from "../pdf/BaseUrls.js";
import type { ComputedStyle } from "../pdf/ComputedStyle.js";
import type { Size } from "../pdf/PageCanvas.js";
import type { QueryContainer } from "../pdf/StyleComputer.js";
import type { ColorSpaceResource } from "../writer/PdfColorSpaces.js";
import type { PdfDocument } from "../writer/PdfDocument.js";
import type { ImageResource, PdfPage } from "../writer/PdfPage.js";
import { PdfSyntax } from "../writer/PdfSyntax.js";

export type ImageReader = (position: number, length: number) => Buffer;

type FormatTest = (read: ImageReader, href: string) => boolean;

interface Registration {
    accepts: FormatTest;
    create: () => ImageFormat;
    format?: ImageFormat;
}

export interface ElementSource {
    element: SourceElement;
    style: ComputedStyle;
}

export interface ImageSize {
    width?: number;
    height?: number;
    ratio?: number;
    density?: readonly [number, number];
    turned: boolean;
    orientation?: number;
    raster: boolean;
    baseline?: number;
}

export interface ImageAlpha {
    width: number;
    height: number;
    bits: 8 | 16;
    alpha?: Buffer;
}

export interface ImageSamples extends ImageAlpha {
    channels: 1 | 3;
    pixels: Buffer;
}

export interface ImageDrawing {
    width: number;
    height: number;
    scale: number;
    rendering: string;
    multiple: readonly [number, number];
}

export interface ImageRequest extends ImageDrawing {
    href: string;
    data: Buffer;
}

export interface ImageFormat {
    size(read: ImageReader, href: string, available?: number): ImageSize | undefined;
    key(drawing: ImageDrawing): string;
    draw(request: ImageRequest): ImageResource | undefined;
    samples(href: string, data: Buffer): readonly [ImageSamples, ColorSpaceResource] | undefined;
    alpha(href: string, data: Buffer): ImageAlpha | undefined;
    style?(element: SourceElement, parent: ComputedStyle | undefined, root: ComputedStyle | undefined, viewport: Size, containers: () => Iterable<QueryContainer>): ComputedStyle;
    replaces?(style: ComputedStyle, element: SourceElement): boolean;
    viewportUsed?(): boolean;
    unclipped?(): boolean;
    glyph?(href: string, data: Buffer, id: string, size: number, scale: number, host: ComputedStyle, pdf: PdfPage, ctm: readonly [number, number, number, number, number, number],
        growth: number): readonly [number, number, number, number] | undefined;
}

const NO_MULTIPLE: readonly [number, number] = [1, 1];
const DATA_SCHEME: string = "data:";
const BASE64_TYPE: RegExp = /;\x20*base64[\t\n\f\r\x20]*$/i;
const ASCII_WHITE_SPACE: RegExp = /[\t\n\f\r\x20]/g;
const BASE64_PADDING: RegExp = /={1,2}$/;
const BASE64_CHARACTERS: RegExp = /^[+/0-9A-Za-z]*$/;
const ELEMENT_SCHEME: string = "element:";
const NO_BYTES: Buffer = Buffer.alloc(0);
const NO_READ: ImageReader = (): Buffer => NO_BYTES;

export class ImageFormats {

    readonly diagnostics: Array<string> = [];
    readonly document: PdfDocument;
    private readonly syntax: PdfSyntax = new PdfSyntax();
    private readonly remote: RemoteResource = new RemoteResource();
    private readonly formats: Array<Registration> = [];
    private readonly elementFormats: Map<string, Registration> = new Map<string, Registration>();
    private readonly byPrefix: Map<string, Registration> = new Map<string, Registration>();
    private rootNamespace?: string;
    private readonly sources: Map<string, ElementSource> = new Map<string, ElementSource>();
    private readonly hrefs: WeakMap<SourceElement, string> = new WeakMap<SourceElement, string>();
    private readonly places: WeakMap<SourceElement, readonly [() => Iterable<QueryContainer>, Size]> = new WeakMap<SourceElement, readonly [() => Iterable<QueryContainer>, Size]>();
    private readonly found: Map<string, Registration | null> = new Map<string, Registration | null>();
    private readonly sizes: Map<string, ImageSize | null> = new Map<string, ImageSize | null>();
    private readonly fittedSizes: Map<string, Map<number, ImageSize | null>> = new Map<string, Map<number, ImageSize | null>>();
    private readonly resources: Map<string, ImageResource | null> = new Map<string, ImageResource | null>();
    private readonly provided: Map<string, () => Buffer> = new Map<string, () => Buffer>();

    constructor(document: PdfDocument) {
        this.document = document;
    }

    provide(href: string, read: () => Buffer): void {
        if (!this.provided.has(href)) {
            this.provided.set(href, read);
        }
    }

    glyph(href: string, id: string, size: number, scale: number, host: ComputedStyle, pdf: PdfPage, ctm: readonly [number, number, number, number, number, number],
        growth: number): readonly [number, number, number, number] | undefined {
        const format: ImageFormat | undefined = this.format(href);
        const data: Buffer | undefined = format?.glyph === undefined ? undefined : this.bytes(href);
        return format?.glyph === undefined || data === undefined ? undefined : format.glyph(href, data, id, size, scale, host, pdf, ctm, growth);
    }

    register(accepts: FormatTest, create: () => ImageFormat, namespaces: ReadonlyArray<string> = []): void {
        // A format is created when the first image in it is met, so a document without such images never holds an instance of it.
        const registration: Registration = { accepts, create };
        this.formats.push(registration);
        for (const namespace of namespaces) {
            this.elementFormats.set(namespace, registration);
        }
    }

    setNamespaces(prefixes: ReadonlyMap<string, string>, rootNamespace?: string): void {
        for (const [prefix, uri] of prefixes) {
            const registration: Registration | undefined = this.elementFormats.get(uri);
            if (registration !== undefined) {
                this.byPrefix.set(prefix, registration);
            }
        }
        if (rootNamespace !== undefined) {
            this.rootNamespace = rootNamespace;
        }
    }

    private elementRegistration(element: SourceElement): Registration | undefined {
        // The tree builder gives an unprefixed element its xmlns unless that is the root's.
        const prefix: string = element.getNamespace();
        if (prefix.length > 0) {
            return this.byPrefix.get(prefix);
        }
        const uri: string | undefined = element.getAttributeValue("xmlns") ?? this.rootNamespace;
        return uri === undefined ? undefined : this.elementFormats.get(uri);
    }

    ownsElement(element: SourceElement): boolean {
        return this.elementRegistration(element) !== undefined;
    }

    elementStyle(element: SourceElement, parent: ComputedStyle | undefined, root: ComputedStyle | undefined, viewport: Size, containers: () => Iterable<QueryContainer>): ComputedStyle | undefined {
        const registration: Registration | undefined = this.elementRegistration(element);
        if (registration === undefined) {
            return undefined;
        }
        this.places.set(element, [containers, viewport]);
        return this.instance(registration).style?.(element, parent, root, viewport, containers);
    }

    elementPlace(element: SourceElement): readonly [() => Iterable<QueryContainer>, Size] | undefined {
        return this.places.get(element);
    }

    viewportUsed(): boolean {
        return this.formats.some((registration: Registration) => registration.format?.viewportUsed?.() === true);
    }

    elementImage(element: SourceElement, style: ComputedStyle): string | undefined {
        // The image is named by an href of its own, so that it is sized, drawn and painted as any other image.
        const registration: Registration | undefined = this.elementRegistration(element);
        if (registration === undefined || this.instance(registration).replaces?.(style, element) !== true) {
            return undefined;
        }
        let href: string | undefined = this.hrefs.get(element);
        if (href === undefined) {
            href = ELEMENT_SCHEME + this.sources.size;
            this.hrefs.set(element, href);
            this.found.set(href, registration);
        }
        this.sources.set(href, { element, style });
        this.sizes.delete(href);
        this.fittedSizes.delete(href);
        return href;
    }

    source(href: string): ElementSource | undefined {
        return this.sources.get(href);
    }

    restart(): void {
        // The formats and the images written refer to objects of the file, which a restarted document no longer has.
        this.resources.clear();
        for (const registration of this.formats) {
            delete registration.format;
        }
    }

    format(href: string): ImageFormat | undefined {
        const known: Registration | null | undefined = this.found.get(href);
        if (known !== undefined) {
            return known === null ? undefined : this.instance(known);
        }
        let format: ImageFormat | undefined;
        this.reading(href, (read: ImageReader) => {
            format = this.recognized(href, read);
        });
        return format;
    }

    size(href: string, available?: number): ImageSize | undefined {
        // The size of an element's image can depend on the space available to it, and is kept for each available size.
        const element: boolean = href.startsWith(ELEMENT_SCHEME);
        if (element && available !== undefined) {
            let fitted: Map<number, ImageSize | null> | undefined = this.fittedSizes.get(href);
            if (fitted === undefined) {
                fitted = new Map<number, ImageSize | null>();
                this.fittedSizes.set(href, fitted);
            }
            let size: ImageSize | null | undefined = fitted.get(available);
            if (size === undefined) {
                size = this.format(href)?.size(NO_READ, href, available) ?? null;
                fitted.set(available, size);
            }
            return size ?? undefined;
        }
        const known: ImageSize | null | undefined = this.sizes.get(href);
        if (known !== undefined) {
            return known ?? undefined;
        }
        let size: ImageSize | undefined;
        if (element) {
            size = this.format(href)?.size(NO_READ, href);
        } else {
            this.reading(href, (read: ImageReader) => {
                size = this.recognized(href, read)?.size(read, href);
            });
        }
        this.sizes.set(href, size ?? null);
        return size;
    }

    unclipped(href: string): boolean {
        return this.format(href)?.unclipped?.() === true;
    }

    image(href: string, drawing: ImageDrawing): ImageResource | undefined {
        const format: ImageFormat | undefined = this.format(href);
        if (format === undefined) {
            return undefined;
        }
        const key: string = href + "#" + format.key(drawing);
        const known: ImageResource | null | undefined = this.resources.get(key);
        if (known !== undefined) {
            return known ?? undefined;
        }
        const data: Buffer | undefined = this.bytes(href);
        const resource: ImageResource | undefined = data === undefined ? undefined : format.draw({ ...drawing, href, data });
        if (data === undefined) {
            this.report(href, "cannot be read" + this.remote.failure(href));
        }
        this.resources.set(key, resource ?? null);
        return resource;
    }

    samples(href: string): readonly [ImageSamples, ColorSpaceResource] | undefined {
        const format: ImageFormat | undefined = this.format(href);
        const data: Buffer | undefined = format === undefined ? undefined : this.bytes(href);
        if (format !== undefined && data === undefined) {
            this.report(href, "cannot be read" + this.remote.failure(href));
        }
        return format === undefined || data === undefined ? undefined : format.samples(href, data);
    }

    alpha(href: string): ImageAlpha | undefined {
        const format: ImageFormat | undefined = this.format(href);
        const data: Buffer | undefined = format === undefined ? undefined : this.bytes(href);
        if (format !== undefined && data === undefined) {
            this.report(href, "cannot be read" + this.remote.failure(href));
        }
        return format === undefined || data === undefined ? undefined : format.alpha(href, data);
    }

    bytes(href: string): Buffer | undefined {
        const provided: (() => Buffer) | undefined = this.provided.get(href);
        if (provided !== undefined) {
            return provided();
        }
        if (href.startsWith(ELEMENT_SCHEME)) {
            return this.sources.has(href) ? NO_BYTES : undefined;
        }
        if (href.startsWith(DATA_SCHEME)) {
            return this.dataBytes(href);
        }
        if (href.startsWith("http:") || href.startsWith("https:")) {
            return this.remote.retrieveBytes(href);
        }
        try {
            return readFileSync(href.startsWith("file:") ? fileURLToPath(href) : href);
        } catch {
            return undefined;
        }
    }

    written(key: string, create: () => ImageResource): ImageResource {
        const known: ImageResource | null | undefined = this.resources.get(key);
        if (known !== undefined && known !== null) {
            return known;
        }
        const resource: ImageResource = create();
        this.resources.set(key, resource);
        return resource;
    }

    write(image: ImageSamples, space: ColorSpaceResource, interpolate: boolean): ImageResource {
        // ISO 32000-2 §11.6.5.2: an alpha channel is a soft-mask image of DeviceGray samples, of the same size as the image.
        const hint: string = interpolate ? " /Interpolate true" : "";
        let mask: string = "";
        if (image.alpha !== undefined) {
            const alpha: number = this.document.file.addStream("/Type /XObject /Subtype /Image /Width " + image.width + " /Height " + image.height
                + " /ColorSpace /DeviceGray /BitsPerComponent " + image.bits + hint, image.alpha, true);
            mask = " /SMask " + this.syntax.reference(alpha);
        }
        const object: number = this.document.file.addStream("/Type /XObject /Subtype /Image /Width " + image.width + " /Height " + image.height + " /ColorSpace "
            + space.value + " /BitsPerComponent " + image.bits + hint + mask, image.pixels, true);
        return { key: "Im" + object, object, width: image.width, height: image.height };
    }

    interpolates(rendering: string): boolean {
        // CSS Images 3 §5.2: crisp-edges "does not blur edges or blend colors from the source image", and optimizeSpeed is
        // treated as crisp-edges; ISO 32000-2 §8.9.5.3: Interpolate is the hint to smooth the other values.
        return rendering !== "crisp-edges" && rendering !== "optimizespeed";
    }

    multiple(rendering: string, target: readonly [number, number], natural: readonly [number, number]): readonly [number, number] {
        // CSS Images 3 §5.2: for pixelated, "For each axis independently, first determine the integer multiple of its natural
        // size that puts it closest to the target size and is greater than zero."
        if (rendering !== "pixelated") {
            return NO_MULTIPLE;
        }
        const along: (axis: number) => number = (axis: number): number => natural[axis] > 0 ? Math.max(1, Math.round(target[axis] / natural[axis])) : 1;
        return [along(0), along(1)];
    }

    rasterKey(drawing: ImageDrawing): string {
        if (!this.interpolates(drawing.rendering)) {
            return "nearest";
        }
        return drawing.multiple[0] === 1 && drawing.multiple[1] === 1 ? "" : drawing.multiple[0] + "x" + drawing.multiple[1];
    }

    isMultiple(drawing: ImageDrawing): boolean {
        return drawing.multiple[0] !== 1 || drawing.multiple[1] !== 1;
    }

    repeated(image: ImageSamples, multiple: readonly [number, number]): ImageSamples {
        // CSS Images 3 §5.2: the first step of pixelated scales the image to the multiple "using nearest neighbor".
        const [across, down]: readonly [number, number] = multiple;
        const bytes: number = image.bits / 8;
        const width: number = image.width * across;
        const height: number = image.height * down;
        const pixels: Buffer = Buffer.alloc(width * height * image.channels * bytes);
        const alpha: Buffer | undefined = image.alpha === undefined ? undefined : Buffer.alloc(width * height * bytes);
        const pixelBytes: number = image.channels * bytes;
        for (let row: number = 0; row < height; row++) {
            const source: number = Math.floor(row / down) * image.width;
            for (let column: number = 0; column < width; column++) {
                const from: number = source + Math.floor(column / across);
                const to: number = row * width + column;
                image.pixels.copy(pixels, to * pixelBytes, from * pixelBytes, (from + 1) * pixelBytes);
                if (alpha !== undefined && image.alpha !== undefined) {
                    image.alpha.copy(alpha, to * bytes, from * bytes, (from + 1) * bytes);
                }
            }
        }
        const result: ImageSamples = { width, height, channels: image.channels, bits: image.bits, pixels };
        if (alpha !== undefined) {
            result.alpha = alpha;
        }
        return result;
    }

    rasterSize(turned: boolean, width?: number, height?: number, density?: readonly [number, number]): ImageSize | undefined {
        if (width === undefined || height === undefined || width <= 0 || height <= 0) {
            return undefined;
        }
        const size: ImageSize = { width, height, ratio: width / height, turned, raster: true };
        if (density !== undefined) {
            size.density = density;
        }
        return size;
    }

    report(href: string, problem: string): void {
        const message: string = "The image " + this.named(href) + " " + problem;
        if (!this.diagnostics.includes(message)) {
            this.diagnostics.push(message);
        }
    }

    missing(href: string, code: string): Error {
        return new Error("The image " + this.named(href) + " needs " + code + ", which is not implemented");
    }

    private dataBytes(href: string): Buffer | undefined {
        // Fetch §6: the body after the first comma, without the fragment, percent-decoded, and base64-decoded when the type
        // ends in ";base64"; Infra §7: forgiving-base64 fails on a length of 4n + 1 or a character outside the alphabet.
        const hash: number = href.indexOf("#");
        const input: string = href.substring(DATA_SCHEME.length, hash < 0 ? href.length : hash);
        const comma: number = input.indexOf(",");
        if (comma < 0) {
            return undefined;
        }
        const body: Buffer = BaseUrls.percentDecoded(input.substring(comma + 1));
        if (!BASE64_TYPE.test(input.substring(0, comma))) {
            return body;
        }
        let data: string = body.toString("latin1").replace(ASCII_WHITE_SPACE, "");
        if (data.length % 4 === 0) {
            data = data.replace(BASE64_PADDING, "");
        }
        return data.length % 4 === 1 || !BASE64_CHARACTERS.test(data) ? undefined : Buffer.from(data, "base64");
    }

    private named(href: string): string {
        return href.startsWith(DATA_SCHEME) ? "given as a data URL" : href;
    }

    private recognized(href: string, read: ImageReader): ImageFormat | undefined {
        const known: Registration | null | undefined = this.found.get(href);
        if (known !== undefined) {
            return known === null ? undefined : this.instance(known);
        }
        const registration: Registration | undefined = this.formats.find((candidate: Registration) => candidate.accepts(read, href));
        if (registration === undefined) {
            this.report(href, "is not in an image format that CSSMedia reads");
        }
        this.found.set(href, registration ?? null);
        return registration === undefined ? undefined : this.instance(registration);
    }

    private instance(registration: Registration): ImageFormat {
        if (registration.format === undefined) {
            registration.format = registration.create();
        }
        return registration.format;
    }

    private reading(href: string, use: (read: ImageReader) => void): void {
        if (this.provided.has(href) || href.startsWith(DATA_SCHEME) || href.startsWith("http:") || href.startsWith("https:")) {
            const data: Buffer | undefined = this.bytes(href);
            if (data === undefined) {
                this.report(href, "cannot be read" + this.remote.failure(href));
                return;
            }
            use((position: number, length: number) => data.subarray(position, position + length));
            return;
        }
        let descriptor: number | undefined;
        try {
            descriptor = openSync(href.startsWith("file:") ? fileURLToPath(href) : href, "r");
            // A directory opens, and only reading it fails.
            readSync(descriptor, Buffer.alloc(1), 0, 1, 0);
        } catch {
            if (descriptor !== undefined) {
                closeSync(descriptor);
            }
            this.report(href, "cannot be read" + this.remote.failure(href));
            return;
        }
        const file: number = descriptor;
        try {
            use((position: number, length: number) => {
                const buffer: Buffer = Buffer.alloc(length);
                return buffer.subarray(0, readSync(file, buffer, 0, length, position));
            });
        } finally {
            closeSync(file);
        }
    }
}
