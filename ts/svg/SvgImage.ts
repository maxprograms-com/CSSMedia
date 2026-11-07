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

import type { XMLDocument, XMLElement } from "typesxml";
import type { DefinitionOverlay } from "../css/PropertyTable.js";
import { PropertyTable } from "../css/PropertyTable.js";
import { SelectorCompiler } from "../css/SelectorCompiler.js";
import type { ContainerQuery, Declaration, DeclaredValue, FontFaceRule, StyleRule, Stylesheet } from "../css/Stylesheet.js";
import { StylesheetReader } from "../css/StylesheetReader.js";
import type { CssValue } from "../css/values/CssValue.js";
import type { ElementSource, ImageAlpha, ImageDrawing, ImageFormat, ImageFormats, ImageReader, ImageRequest, ImageSamples, ImageSize } from "../images/ImageFormats.js";
import type { ColorOutput } from "../paint/ColorOutput.js";
import type { SourceElement } from "../parse/SourceElement.js";
import type { XmlRootHandler } from "../parse/XmlRootHandler.js";
import { XmlTreeBuilder } from "../parse/XmlTreeBuilder.js";
import type { DocumentFonts, Input, PageSetup } from "../PdfGenerator.js";
import { BaseUrls } from "../pdf/BaseUrls.js";
import { Cascade } from "../pdf/Cascade.js";
import type { ComputedStyle } from "../pdf/ComputedStyle.js";
import { DisplayTypes } from "../pdf/DisplayTypes.js";
import type { Size } from "../pdf/PageCanvas.js";
import type { QueryContainer } from "../pdf/StyleComputer.js";
import { StyleComputer } from "../pdf/StyleComputer.js";
import { UserAgentRules } from "../pdf/UserAgentRules.js";
import type { ColorSpaceResource } from "../writer/PdfColorSpaces.js";
import type { PdfDocument } from "../writer/PdfDocument.js";
import type { ImageResource, PageRectangle, PdfPage } from "../writer/PdfPage.js";
import { SVG_PROPERTIES, SVG_TYPES } from "./generated/SvgDefinitions.js";
import type { Box } from "./SvgGeometry.js";
import { SvgGeometry } from "./SvgGeometry.js";
import { SvgPainter } from "./SvgPainter.js";
import { SvgParser } from "./SvgParser.js";
import { SvgStyles } from "./SvgStyles.js";

const SCALE_STEPS: number = 4;
const SVG_DEFINITIONS: DefinitionOverlay = { properties: SVG_PROPERTIES, types: SVG_TYPES, shorthands: [["marker", ["marker-start", "marker-mid", "marker-end"]]] };
const SVG_NAMESPACE: string = "http://www.w3.org/2000/svg";
const SVG_ROOT: string = "svg";
const DISPLAY_NONE: CssValue = { kind: "ident", name: "none", lower: "none" };

export class SvgImage implements ImageFormat {

    static readonly NAMESPACES: ReadonlyArray<string> = [SVG_NAMESPACE];

    private readonly document: PdfDocument;
    private readonly images: ImageFormats;
    private readonly input: Input;
    private readonly setup: () => PageSetup;
    private readonly displays: DisplayTypes = new DisplayTypes();
    private boxes?: Cascade;
    private hostSheet?: Stylesheet;
    private lastRoot?: readonly [SourceElement, SvgStyles];
    private readonly parser: SvgParser = new SvgParser();
    private readonly table: PropertyTable = new PropertyTable(SVG_DEFINITIONS);
    private readonly geometry: SvgGeometry = new SvgGeometry();
    private readonly painter: SvgPainter;
    private readonly documents: Map<string, SvgStyles | null> = new Map<string, SvgStyles | null>();
    private readonly drawing: Set<string> = new Set<string>();

    constructor(document: PdfDocument, images: ImageFormats, colors: ColorOutput, input: Input, setup: () => PageSetup) {
        this.document = document;
        this.images = images;
        this.input = input;
        this.setup = setup;
        this.painter = new SvgPainter(document, images, colors, this);
    }

    static accepts(read: ImageReader, href: string): boolean {
        const root: XmlRootHandler = new XmlTreeBuilder().imageRoot(read, href);
        return root.localName() === SVG_ROOT && root.namespace() === SVG_NAMESPACE;
    }

    replaces(style: ComputedStyle, element: SourceElement): boolean {
        // SVG 2 §8.3: the image is an outermost svg element; another element of the namespace outside one is not drawn by itself.
        return element.getLocalName() === SVG_ROOT;
    }

    style(element: SourceElement, parent: ComputedStyle | undefined, root: ComputedStyle | undefined, viewport: Size, containers: () => Iterable<QueryContainer>): ComputedStyle {
        const computer: StyleComputer = this.input.computer;
        const cascaded: Map<string, DeclaredValue> = this.boxCascade().element(element, (queries: ReadonlyArray<ContainerQuery>) =>
            computer.containersHold(queries, containers, viewport));
        const style: ComputedStyle = computer.compute(StyleComputer.input(cascaded, viewport, containers, parent, root, element));
        if (this.displays.parse(style.values["display"]).box !== "contents") {
            return style;
        }
        // CSS Display 3 Appendix B: on an svg element with CSS box layout, "display: contents computes to display: none".
        return { ...style, values: Object.assign(Object.create(style.values) as Record<string, CssValue>, { display: DISPLAY_NONE }) };
    }

    private boxCascade(): Cascade {
        // A cascade of its own, so that the document's holds no SVG rules or hints.
        if (this.boxes === undefined) {
            const input: Input = this.input;
            const agent: UserAgentRules = new UserAgentRules(input.table);
            const rules: Array<StyleRule> = agent.styleRules();
            rules.push(agent.rule("svg:not(:root)", "overflow: hidden", rules.length, new Map<string, string>([[SelectorCompiler.DEFAULT_NAMESPACE, SVG_NAMESPACE]])));
            this.boxes = new Cascade(input.root, input.prefixes, input.documentUri, input.styleRules, rules, input.computer,
                (element: SourceElement): ReadonlyArray<Declaration> => this.images.ownsElement(element) ? this.rootStyles(element).boxHints() : [],
                (element: SourceElement): ReadonlyArray<Declaration> => this.images.ownsElement(element) ? this.rootStyles(element).styleAttribute() : [],
                (element: SourceElement): ReadonlyArray<string> | undefined => this.images.ownsElement(element) ? this.rootStyles(element).classNames() : undefined);
        }
        return this.boxes;
    }

    private rootStyles(element: SourceElement): SvgStyles {
        if (this.lastRoot?.[0] !== element) {
            this.lastRoot = [element, this.elementStyles(element)];
        }
        return this.lastRoot[1];
    }

    private elementStyles(element: SourceElement): SvgStyles {
        // An element of the document can use a prefix that is declared above it, so its scope starts with the document's.
        const scope: Map<string, string> = new Map<string, string>(this.input.prefixes);
        const rootNamespace: string | undefined = this.input.root.getAttributeValue("xmlns");
        if (rootNamespace !== undefined) {
            scope.set("", rootNamespace);
        }
        return new SvgStyles(element, new BaseUrls(this.input.documentUri).of(element), this.table, (rules: ReadonlyArray<FontFaceRule>): DocumentFonts => this.elementFonts(rules),
            (resource: string) => this.images.bytes(resource), scope);
    }

    private elementFonts(rules: ReadonlyArray<FontFaceRule>): DocumentFonts {
        // CSS Fonts 4 §4: the element is part of the document, so its fonts are the document's and those of its own style elements.
        const input: Input = this.input;
        return rules.length === 0 ? input.fonts : input.fontsFor([...input.fontFaces, ...rules]);
    }

    private embedded(source: ElementSource): SvgStyles {
        // The style sheet is read again with the SVG properties, only when a document has an svg element to apply it to.
        const input: Input = this.input;
        const styles: SvgStyles = this.elementStyles(source.element);
        const setup: PageSetup = this.setup();
        const [containers, viewport]: readonly [() => Iterable<QueryContainer>, Size] = this.images.elementPlace(source.element) ?? [StyleComputer.NO_CONTAINERS, setup.viewport];
        this.hostSheet = this.hostSheet ?? new StylesheetReader(this.table).read(input.cssPath);
        styles.embed(this.hostSheet.styleRules, this.hostSheet.layerCount - 1, source.style, setup.root.values, input.root, (queries: ReadonlyArray<ContainerQuery>) =>
            input.computer.containersHold(queries, containers, viewport));
        return styles;
    }

    size(read: ImageReader, href: string): ImageSize | undefined {
        // SVG 2 §8.3: the computed width and height of the outermost svg element, none when auto or a percentage, and its
        // viewBox for the aspect ratio when one is missing; the parsed image is not kept, since it may never be drawn.
        const source: ElementSource | undefined = this.images.source(href);
        let styles: SvgStyles;
        if (source !== undefined) {
            styles = this.embedded(source);
        } else {
            let parsed: XMLDocument;
            try {
                parsed = this.parser.parse(read, href);
            } catch {
                return undefined;
            }
            styles = new SvgStyles(parsed, href, this.table, this.input.fontsFor, (resource: string) => this.images.bytes(resource));
        }
        if (!styles.isSvg(styles.root, SVG_ROOT)) {
            return undefined;
        }
        if (source !== undefined) {
            this.register(styles);
        }
        const style: ComputedStyle = styles.style(styles.rootNode());
        const width: number | undefined = this.natural(style.values["width"]);
        const height: number | undefined = this.natural(style.values["height"]);
        const box: Box | undefined = this.geometry.viewBox(styles.attribute(styles.root, "viewBox"));
        let ratio: number | undefined = box !== undefined && box[2] > 0 && box[3] > 0 ? box[2] / box[3] : undefined;
        if (width !== undefined && height !== undefined && width > 0 && height > 0) {
            ratio = width / height;
        }
        const size: ImageSize = { turned: false, raster: false };
        if (width !== undefined) {
            size.width = width;
        }
        if (height !== undefined) {
            size.height = height;
        }
        if (ratio !== undefined) {
            size.ratio = ratio;
        }
        return size;
    }

    key(drawing: ImageDrawing): string {
        // SVG 2 §8.3: the image is drawn into a viewport of the size it is given, and its curves and resampled images are as
        // fine as the scale it is shown at needs, so each size and each step of scale is a drawing of its own.
        return drawing.width + "x" + drawing.height + "@" + this.scaleStep(drawing.scale);
    }

    draw(request: ImageRequest): ImageResource | undefined {
        return this.form(request.href, request.data, request.width, request.height, this.scaleStep(request.scale));
    }

    private scaleStep(scale: number): number {
        // A quarter of an octave, rounded up so that a drawing is never coarser than the scale it is shown at.
        return Number.isFinite(scale) && scale > 0 ? Math.pow(2, Math.ceil(Math.log2(scale) * SCALE_STEPS) / SCALE_STEPS) : 1;
    }

    samples(href: string): readonly [ImageSamples, ColorSpaceResource] | undefined {
        throw this.images.missing(href, "the rendering of an SVG image into samples");
    }

    alpha(href: string): ImageAlpha | undefined {
        throw this.images.missing(href, "the rendering of an SVG image into an alpha channel");
    }

    form(href: string, data: Buffer, width: number, height: number, scale: number): ImageResource | undefined {
        // SVG 2 §8.3 and §8.4: the image's viewport is the area it is given, one user unit to one CSS pixel; an image that
        // contains itself is in error.
        if (this.drawing.has(href)) {
            this.images.report(href, "refers to itself");
            return undefined;
        }
        const styles: SvgStyles | undefined = this.read(href, data);
        if (styles === undefined || width <= 0 || height <= 0) {
            return undefined;
        }
        const form: PdfPage = this.document.startForm(width, height, true);
        this.drawing.add(href);
        let links: ReadonlyArray<readonly [PageRectangle, string, boolean]> = [];
        try {
            links = this.painter.paint(styles, form, width, height, scale);
        } finally {
            this.finished(href);
        }
        const resource: ImageResource = this.document.finishForm(form, [0, 0, width, height], [1 / width, 0, 0, 1 / height, 0, 0]);
        if (links.length > 0) {
            // The link areas of the image are in its unit square, with v going down as in its viewport.
            resource.links = links.map(([area, name, internal]: readonly [PageRectangle, string, boolean]): readonly [PageRectangle, string, boolean] =>
                [{ x: area.x / width, y: area.y / height, width: area.width / width, height: area.height / height }, name, internal]);
        }
        return resource;
    }

    private register(styles: SvgStyles): void {
        // The destinations that the links of a drawing in the document name are known before any page is painted, since a page
        // adds the destinations of its boxes before the images that its text holds are drawn.
        const visit: (element: XMLElement) => void = (element: XMLElement): void => {
            for (const child of element.getChildren()) {
                if (!styles.isSvg(child)) {
                    continue;
                }
                const href: string | undefined = styles.localName(child) === "a" ? styles.href(child) : undefined;
                if (href !== undefined) {
                    this.link(styles.resolve(href), styles.url);
                }
                visit(child);
            }
        };
        visit(styles.root);
    }

    link(url: string, own: string): readonly [string, boolean] | undefined {
        // A fragment of the document that holds the image names a destination of the page, as it does for a formula; one of
        // the image's own file has no place in a PDF.
        const name: string | undefined = this.setup().references.link(url, this.input.cascade.linkTarget(url));
        if (name !== undefined) {
            return [name, true];
        }
        return url.split("#")[0] === own.split("#")[0] ? undefined : [url, false];
    }

    inline(href: string, draw: (styles: SvgStyles) => void): void {
        if (this.drawing.has(href)) {
            this.images.report(href, "refers to itself");
            return;
        }
        const styles: SvgStyles | undefined = this.styles(href);
        if (styles === undefined) {
            return;
        }
        this.drawing.add(href);
        try {
            draw(styles);
        } finally {
            this.finished(href);
        }
    }

    private finished(href: string): void {
        // The parsed documents are needed only while an image is drawn, and its form is kept; holding them for the rest of
        // the run would keep every image of a large document in memory.
        this.drawing.delete(href);
        if (this.drawing.size === 0) {
            this.documents.clear();
        }
    }

    styles(url: string): SvgStyles | undefined {
        const known: SvgStyles | null | undefined = this.documents.get(url);
        if (known !== undefined) {
            return known ?? undefined;
        }
        const data: Buffer | undefined = this.images.bytes(url);
        if (data === undefined) {
            this.images.report(url, "cannot be read");
            this.documents.set(url, null);
            return undefined;
        }
        return this.read(url, data);
    }

    private read(url: string, data: Buffer): SvgStyles | undefined {
        const known: SvgStyles | null | undefined = this.documents.get(url);
        if (known !== undefined) {
            return known ?? undefined;
        }
        const source: ElementSource | undefined = this.images.source(url);
        if (source !== undefined) {
            const embedded: SvgStyles = this.embedded(source);
            embedded.loadSheets();
            this.images.diagnostics.push(...embedded.diagnostics);
            this.documents.set(url, embedded);
            return embedded;
        }
        let parsed: XMLDocument;
        try {
            parsed = this.parser.parse((position: number, length: number) => data.subarray(position, position + length), url);
        } catch (error) {
            this.images.report(url, "cannot be parsed: " + (error instanceof Error ? error.message : String(error)));
            this.documents.set(url, null);
            return undefined;
        }
        let styles: SvgStyles | undefined = new SvgStyles(parsed, url, this.table, this.input.fontsFor, (resource: string) => this.images.bytes(resource));
        styles.loadSheets();
        this.images.diagnostics.push(...styles.diagnostics);
        if (!styles.isSvg(styles.root, SVG_ROOT)) {
            this.images.report(url, "is not an SVG document");
            styles = undefined;
        }
        this.documents.set(url, styles ?? null);
        return styles;
    }

    private natural(value: CssValue | undefined): number | undefined {
        // CSS Values 4 §6: "For zero lengths the unit identifier is optional", so width="0" parses as a number.
        if (value !== undefined && value.kind === "number" && value.value === 0) {
            return 0;
        }
        return value !== undefined && value.kind === "length" ? value.px : undefined;
    }
}
