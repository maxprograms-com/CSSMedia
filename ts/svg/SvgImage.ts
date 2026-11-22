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
import type { ContainerQuery, Declaration, DeclaredValue, FontFaceRule, FontFeatureValuesRule, StyleRule, Stylesheet } from "../css/Stylesheet.js";
import { StylesheetReader } from "../css/StylesheetReader.js";
import type { CssValue } from "../css/values/CssValue.js";
import type { ElementSource, ImageAlpha, ImageDrawing, ImageFormat, ImageFormats, ImageReader, ImageRequest, ImageSamples, ImageSize, UnboxedPlace } from "../images/ImageFormats.js";
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
import type { Box, SvgPath } from "./SvgGeometry.js";
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
    private readonly boxStyles: WeakMap<SourceElement, ComputedStyle> = new WeakMap<SourceElement, ComputedStyle>();
    private readonly clipSources: Map<SourceElement, SvgStyles> = new Map<SourceElement, SvgStyles>();
    private documentIds?: Map<string, SourceElement>;

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

    replaces(source: ElementSource): boolean {
        // SVG 2 §8.3: the image is an outermost svg element; another element of the namespace outside one is not drawn by itself.
        return source.element.getLocalName() === SVG_ROOT;
    }

    style(element: SourceElement, parent: ComputedStyle | undefined, root: ComputedStyle | undefined, viewport: Size, containers: () => Iterable<QueryContainer>): ComputedStyle {
        const computer: StyleComputer = this.input.computer;
        const cascaded: Map<string, DeclaredValue> = this.boxCascade().element(element, (queries: ReadonlyArray<ContainerQuery>) =>
            computer.containersHold(queries, containers, viewport));
        const computed: ComputedStyle = computer.compute(StyleComputer.input(cascaded, viewport, containers, parent, root, element));
        // CSS Display 3 Appendix B: on an svg element with CSS box layout, "display: contents computes to display: none".
        const style: ComputedStyle = this.displays.parse(computed.values["display"]).box !== "contents" ? computed
            : { ...computed, values: Object.assign(Object.create(computed.values) as Record<string, CssValue>, { display: DISPLAY_NONE }) };
        if (element.getLocalName() === SVG_ROOT) {
            this.boxStyles.set(element, style);
        }
        return style;
    }

    clip(href: string, pdf: PdfPage, place: Box, area: Box, boxes: (kind: string) => Box | undefined, rtl: boolean, scale: number): ImageResource | null | undefined {
        const found: readonly [XMLElement, SvgStyles] | undefined = this.clipTarget(href);
        return found === undefined ? undefined : this.painter.clipFor(found[1], found[0], pdf, place, area, boxes, rtl, scale);
    }

    clipOutlines(href: string, place: Box, boxes: (kind: string) => Box | undefined, rtl: boolean): Array<Array<readonly [SvgPath, boolean]>> | null | undefined {
        const found: readonly [XMLElement, SvgStyles] | undefined = this.clipTarget(href);
        return found === undefined ? undefined : this.painter.clipOutlines(found[1], found[0], place, boxes, rtl);
    }

    private clipTarget(href: string): readonly [XMLElement, SvgStyles] | undefined {
        // CSS Masking 1 §5.1: a reference to anything but a clipPath element applies no clipping; CSS Values 4 §4.5.1: a fragment-only URL
        // names an element of the document.
        const hash: number = href.indexOf("#");
        if (hash < 0) {
            return undefined;
        }
        const id: string = BaseUrls.percentDecoded(href.substring(hash + 1)).toString("utf8");
        const address: string = href.substring(0, hash);
        let found: readonly [XMLElement, SvgStyles] | undefined;
        if (address.length === 0 || address === this.input.documentUri) {
            found = this.documentClip(id);
        } else {
            const styles: SvgStyles | undefined = this.styles(address);
            const element: XMLElement | undefined = styles?.element(id);
            found = styles === undefined || element === undefined ? undefined : [element, styles];
        }
        return found === undefined || !found[1].isSvg(found[0], "clipPath") ? undefined : found;
    }

    private documentClip(id: string): readonly [XMLElement, SvgStyles] | undefined {
        // CSS Masking 1 §6.1: a clipPath can be referenced "even when the display property on the clipPath element or any of its ancestors is
        // set to none"; its styles are those of the outermost svg element that holds it.
        const element: SourceElement | undefined = this.documentElement(id);
        let root: SourceElement | undefined;
        for (let current: SourceElement | undefined = element; current !== undefined && this.images.elementFormat(current) === this; current = current.getParent()) {
            if (current.getLocalName() === SVG_ROOT) {
                root = current;
            }
        }
        if (element === undefined || root === undefined) {
            return undefined;
        }
        let styles: SvgStyles | undefined = this.clipSources.get(root);
        if (styles === undefined) {
            const known: ComputedStyle | undefined = this.boxStyles.get(root);
            const place: readonly [ComputedStyle, () => Iterable<QueryContainer>] | undefined = known === undefined ? this.documentPlace(root) : undefined;
            styles = place === undefined ? this.embedded({ element: root, style: known as ComputedStyle })
                : this.embedded({ element: root, style: place[0] }, [place[1], this.setup().viewport]);
            styles.loadSheets();
            this.images.diagnostics.push(...styles.diagnostics);
            this.clipSources.set(root, styles);
        }
        return [element, styles];
    }

    private documentElement(id: string): SourceElement | undefined {
        // The first element of the document with the id, as SvgStyles finds those of another svg element.
        if (this.documentIds === undefined) {
            const ids: Map<string, SourceElement> = new Map<string, SourceElement>();
            const pending: Array<SourceElement> = [this.input.root];
            while (pending.length > 0) {
                const current: SourceElement = pending.pop() as SourceElement;
                const own: string | undefined = current.getAttribute("id")?.getValue() ?? current.getAttribute("xml:id")?.getValue();
                if (own !== undefined && !ids.has(own)) {
                    ids.set(own, current);
                }
                const children: Array<XMLElement> = current.getChildren();
                for (let child: number = children.length - 1; child >= 0; child--) {
                    pending.push(children[child] as SourceElement);
                }
            }
            this.documentIds = ids;
        }
        return this.documentIds.get(id);
    }

    private documentPlace(element: SourceElement): readonly [ComputedStyle, () => Iterable<QueryContainer>] {
        // An svg element that makes no box has the style that the cascade gives it below the element whose descendants make no boxes, whose style
        // and containers the box builder keeps; CSS Conditional 5 §5 and §6.1: each ancestor is a style container, one without a box has no size.
        const setup: PageSetup = this.setup();
        const computer: StyleComputer = this.input.computer;
        const chain: Array<SourceElement> = [];
        let top: UnboxedPlace | undefined;
        for (let current: SourceElement | undefined = element.getParent(); current !== undefined && top === undefined; current = current.getParent()) {
            top = this.images.unboxedPlace(current);
            if (top === undefined) {
                chain.unshift(current);
            }
        }
        chain.push(element);
        let parent: ComputedStyle | undefined = top?.style;
        let containers: () => Iterable<QueryContainer> = top?.containers ?? StyleComputer.NO_CONTAINERS;
        for (const current of chain) {
            const own: () => Iterable<QueryContainer> = containers;
            if (current === element) {
                const holds: (queries: ReadonlyArray<ContainerQuery>) => boolean = (queries: ReadonlyArray<ContainerQuery>): boolean =>
                    computer.containersHold(queries, own, setup.viewport);
                return [computer.compute(StyleComputer.input(this.boxCascade().element(current, holds), setup.viewport, own, parent, setup.root, current)), own];
            }
            const holds: (queries: ReadonlyArray<ContainerQuery>) => boolean = (queries: ReadonlyArray<ContainerQuery>): boolean =>
                computer.containersHold(queries, own, setup.viewport);
            const style: ComputedStyle = current === this.input.root ? setup.root
                : computer.compute(StyleComputer.input(this.input.cascade.element(current, holds), setup.viewport, own, parent, setup.root, current));
            const container: QueryContainer = { element: current, style, root: setup.root };
            if (parent !== undefined) {
                container.parent = parent;
            }
            containers = (): Iterable<QueryContainer> => [container, ...own()];
            parent = style;
        }
        return [parent ?? setup.root, containers];
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
        return new SvgStyles(element, new BaseUrls(this.input.documentUri).of(element), this.table, this.input.computer, this.input.profiles,
            (rules: ReadonlyArray<FontFaceRule>, features: ReadonlyArray<FontFeatureValuesRule>): DocumentFonts => this.elementFonts(rules, features),
            (resource: string) => this.images.bytes(resource), scope);
    }

    private elementFonts(rules: ReadonlyArray<FontFaceRule>, features: ReadonlyArray<FontFeatureValuesRule>): DocumentFonts {
        // CSS Fonts 4 §4: the element is part of the document, so its fonts are the document's and those of its own style elements.
        const input: Input = this.input;
        return rules.length === 0 && features.length === 0 ? input.fonts : input.fontsFor([...input.fontFaces, ...rules], [...input.fontFeatureValues, ...features]);
    }

    private embedded(source: ElementSource, place?: readonly [() => Iterable<QueryContainer>, Size]): SvgStyles {
        // The style sheet is read again with the SVG properties, only when a document has an svg element to apply it to.
        const input: Input = this.input;
        const styles: SvgStyles = this.elementStyles(source.element);
        const setup: PageSetup = this.setup();
        const [containers, viewport]: readonly [() => Iterable<QueryContainer>, Size] = place ?? this.images.elementPlace(source.element)
            ?? [StyleComputer.NO_CONTAINERS, setup.viewport];
        this.hostSheet = this.hostSheet ?? new StylesheetReader(this.table).read(input.cssPath);
        styles.embed(this.hostSheet, source.style, setup.root, setup.palettes, input.root, containers, viewport);
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
            styles = new SvgStyles(parsed, href, this.table, this.input.computer, this.input.profiles, this.input.fontsFor, (resource: string) => this.images.bytes(resource));
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

    diagnose(message: string): void {
        if (!this.images.diagnostics.includes(message)) {
            this.images.diagnostics.push(message);
        }
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

    glyph(href: string, data: Buffer, id: string, size: number, scale: number, host: ComputedStyle, pdf: PdfPage, ctm: readonly [number, number, number, number, number, number],
        growth: number): Box | undefined {
        // The text around the glyph gives the root its color and its palette, so the document is read for each glyph.
        let parsed: XMLDocument;
        try {
            parsed = this.parser.parse((position: number, length: number) => data.subarray(position, position + length), href);
        } catch (error) {
            this.images.report(href, "cannot be parsed: " + (error instanceof Error ? error.message : String(error)));
            return undefined;
        }
        const styles: SvgStyles = new SvgStyles(parsed, href, this.table, this.input.computer, this.input.profiles, this.input.fontsFor,
            (resource: string) => this.images.bytes(resource));
        styles.loadSheets();
        this.images.diagnostics.push(...styles.diagnostics);
        const element: XMLElement | undefined = styles.element(id);
        if (!styles.isSvg(styles.root, SVG_ROOT) || element === undefined) {
            return undefined;
        }
        styles.host(host);
        this.drawing.add(href);
        try {
            return this.painter.glyph(styles, pdf, element, size, scale, ctm, growth);
        } finally {
            this.finished(href);
        }
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
        let styles: SvgStyles | undefined = new SvgStyles(parsed, url, this.table, this.input.computer, this.input.profiles, this.input.fontsFor,
            (resource: string) => this.images.bytes(resource));
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
