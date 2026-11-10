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

import type { XMLElement } from "typesxml";
import type { CssValue } from "../css/values/CssValue.js";
import type { StrokeStyle } from "../geometry/PathGeometry.js";
import { PathGeometry } from "../geometry/PathGeometry.js";
import type { ImageFormats, ImageSamples, ImageSize } from "../images/ImageFormats.js";
import type { ColorOutput, PdfColor } from "../paint/ColorOutput.js";
import { BaseUrls } from "../pdf/BaseUrls.js";
import type { ComputedStyle } from "../pdf/ComputedStyle.js";
import type { ColorSpaceResource } from "../writer/PdfColorSpaces.js";
import { PdfColorSpaces } from "../writer/PdfColorSpaces.js";
import type { PdfDocument } from "../writer/PdfDocument.js";
import type { ImageResource, PageRectangle } from "../writer/PdfPage.js";
import { PdfPage } from "../writer/PdfPage.js";
import type { ColorStop, ShadingRepeat, ShadingResource } from "../writer/PdfShadings.js";
import { PdfSyntax } from "../writer/PdfSyntax.js";
import type { Box, Facet, Homography, Matrix, Matrix4, SvgPath } from "./SvgGeometry.js";
import { SvgGeometry } from "./SvgGeometry.js";
import type { SvgImage } from "./SvgImage.js";
import type { SvgNode, SvgStyles } from "./SvgStyles.js";
import { SvgText } from "./SvgText.js";

const NEVER_RENDERED: ReadonlySet<string> = new Set<string>(["clipPath", "defs", "desc", "linearGradient", "marker", "mask", "metadata", "pattern", "radialGradient",
    "script", "style", "title", "symbol", "filter", "view"]);
const SHAPES: ReadonlySet<string> = new Set<string>(["rect", "circle", "ellipse", "line", "polyline", "polygon", "path"]);
const DESCRIPTIVE: ReadonlySet<string> = new Set<string>(["desc", "title", "metadata"]);
const CLIPPING_OVERFLOW: ReadonlySet<string> = new Set<string>(["hidden", "scroll", "clip"]);
const CAPS: Readonly<Record<string, number>> = { butt: 0, round: 1, square: 2 };
const JOINS: Readonly<Record<string, number>> = { miter: 0, round: 1, bevel: 2 };
const SHAPE_JOINS: Readonly<Record<string, readonly [string, string]>> = { miter: ["miter", "fallback"], round: ["crop", "round"], bevel: ["crop", "bevel"] };
const BLEND_MODES: Readonly<Record<string, string>> = {
    normal: "Normal", multiply: "Multiply", screen: "Screen", overlay: "Overlay", darken: "Darken", lighten: "Lighten", "color-dodge": "ColorDodge",
    "color-burn": "ColorBurn", "hard-light": "HardLight", "soft-light": "SoftLight", difference: "Difference", exclusion: "Exclusion", hue: "Hue",
    saturation: "Saturation", color: "Color", luminosity: "Luminosity"
};
const REFERENCE_KEYWORDS: Readonly<Record<string, number>> = { left: 0, top: 0, center: 0.5, right: 1, bottom: 1 };
const SRGB_WHITE: ReadonlyArray<number> = [0.9505, 1, 1.089];
const SRGB_MATRIX: ReadonlyArray<number> = [0.4124, 0.2126, 0.0193, 0.3576, 0.7152, 0.1192, 0.1805, 0.0722, 0.9505];
const FLAT_TRANSFORMS: ReadonlySet<string> = new Set<string>(["clipPath", "linearGradient", "radialGradient", "pattern"]);
const FLATNESS: number = 0.05;
const MITER_LIMIT: number = 4;
const FINEST_PIXEL: number = 96 / 600;
const LARGEST_IMAGE: number = 4096 * 4096;
const MAX_TAPS: number = 16;
const NEAREST_RENDERING: ReadonlySet<string> = new Set<string>(["crisp-edges", "optimizespeed"]);
const SPREADS: Readonly<Record<string, string>> = {
    pad: "dup 0 lt { pop 0 } if dup 1 gt { pop 1 } if", repeat: "dup floor sub", reflect: "dup 2 div floor 2 mul sub dup 1 gt { 2 exch sub } if"
};

type Plane = readonly [() => void, Box, Matrix4];

type Space = readonly [Array<Plane | undefined>, Matrix4, boolean];

type State = readonly [SvgStyles, number, number, ComputedStyle | undefined, Box | undefined, ReadonlySet<XMLElement>];

export class SvgPainter {

    styles!: SvgStyles;
    pdf!: PdfPage;
    width: number = 0;
    height: number = 0;
    private ctm: Matrix = SvgGeometry.IDENTITY;
    private base: Matrix = SvgGeometry.IDENTITY;
    private origin: Matrix = SvgGeometry.IDENTITY;
    private area: Box = [0, 0, 0, 0];
    private scale: number = 1;
    private space?: Space;
    private projection?: Homography;
    private collecting: boolean = false;
    private growth: number = 0;
    private links: Array<readonly [PageRectangle, string, boolean]> = [];
    private formHeight: number = 0;
    private quiet: number = 0;
    private tiling?: () => void;
    private readonly syntax: PdfSyntax = new PdfSyntax();
    private context?: ComputedStyle;
    private contextBox?: Box;
    private readonly document: PdfDocument;
    private readonly formats: ImageFormats;
    private readonly colors: ColorOutput;
    private readonly images: SvgImage;
    private readonly geometry: SvgGeometry = new SvgGeometry();
    private readonly text: SvgText;
    private readonly active: Set<XMLElement> = new Set<XMLElement>();
    private linearSpace?: ColorSpaceResource;

    constructor(document: PdfDocument, formats: ImageFormats, colors: ColorOutput, images: SvgImage) {
        this.document = document;
        this.formats = formats;
        this.colors = colors;
        this.images = images;
        this.text = new SvgText(document, formats, colors, this);
    }

    paint(styles: SvgStyles, pdf: PdfPage, width: number, height: number, scale: number): ReadonlyArray<readonly [PageRectangle, string, boolean]> {
        // SVG 2 §8.4: the initial user space has its origin at the top left with y down, in a form drawn upside down; an
        // image inside another one gives the painter back to the outer image when it is drawn.
        styles.setViewport(width, height);
        const node: SvgNode = styles.rootNode();
        const style: ComputedStyle = styles.style(node);
        const saved: readonly [number, Array<readonly [PageRectangle, string, boolean]>, number, number, Matrix, Matrix] =
            [this.scale, this.links, this.formHeight, this.quiet, this.ctm, this.origin];
        this.scale = scale;
        this.links = [];
        this.formHeight = height;
        this.quiet = 0;
        this.ctm = SvgGeometry.IDENTITY;
        this.origin = SvgGeometry.IDENTITY;
        try {
            this.inDocument(styles, width, height, undefined, undefined, () => this.drawIn(pdf, [1, 0, 0, -1, 0, height], [0, 0, width, height], () =>
                this.effects(node, style, SvgGeometry.IDENTITY, () => this.viewport(node, style, [0, 0, width, height], undefined)), SvgGeometry.IDENTITY));
            return this.links;
        } finally {
            [this.scale, this.links, this.formHeight, this.quiet, this.ctm, this.origin] = saved;
        }
    }

    glyph(styles: SvgStyles, pdf: PdfPage, element: XMLElement, size: number, scale: number, ctm: Matrix, growth: number): Box | undefined {
        // OpenType SVG: the element is rendered "according to SVG's <use> tag behavior", in an initial viewport of the em square
        // that "must not be clipped"; CSS Fonts 4 §2.8: a synthesized bold glyph has a thin stroke around each shape it paints.
        styles.setViewport(size, size);
        const node: SvgNode = styles.rootNode();
        const style: ComputedStyle = styles.style(node);
        const saved: readonly [number, Array<readonly [PageRectangle, string, boolean]>, number, number, Matrix, Matrix] =
            [this.scale, this.links, this.formHeight, this.quiet, this.ctm, this.origin];
        const savedGrowth: number = this.growth;
        this.growth = growth;
        this.scale = scale;
        this.links = [];
        this.formHeight = size;
        this.quiet = 1;
        this.ctm = SvgGeometry.IDENTITY;
        this.origin = SvgGeometry.IDENTITY;
        let ink: Box | undefined;
        try {
            this.inDocument(styles, size, size, undefined, undefined, () => this.drawIn(pdf, ctm, [0, 0, size, size], () => {
                const placement: readonly [Matrix, number, number] | undefined = this.placement(node.element, this.rectangle(style), undefined);
                if (placement === undefined) {
                    return;
                }
                this.transformed(placement[0], () => this.inDocument(styles, placement[1], placement[2], undefined, undefined, () => {
                    this.guarded(element, () => this.render({ element }, style));
                    const instance: SvgNode = { element };
                    const own: ComputedStyle = styles.style(instance, style);
                    const box: Box | undefined = this.bbox(instance, own, "ink");
                    const transform: Matrix | null | undefined = this.geometry.flatten(this.elementTransform(instance, own, styles));
                    if (box !== undefined && transform !== undefined && transform !== null) {
                        ink = this.geometry.transformBox(this.geometry.concat(placement[0], transform), box);
                    }
                }));
            }, SvgGeometry.IDENTITY));
        } finally {
            [this.scale, this.links, this.formHeight, this.quiet, this.ctm, this.origin] = saved;
            this.growth = savedGrowth;
        }
        return ink === undefined || growth <= 0 ? ink : [ink[0] - growth / 2, ink[1] - growth / 2, ink[2] + growth, ink[3] + growth];
    }

    private drawIn(pdf: PdfPage, ctm: Matrix, area: Box, draw: () => void, base: Matrix = this.imageMatrix()): void {
        const saved: readonly [PdfPage | undefined, Matrix, Box, Matrix, Matrix] = [this.pdf as PdfPage | undefined, this.ctm, this.area, this.base, this.origin];
        // The space of the new form is the user space around it, which is what the links inside it are measured from.
        this.origin = this.geometry.concat(this.origin, this.ctm);
        this.pdf = pdf;
        this.ctm = ctm;
        this.area = area;
        this.base = base;
        try {
            draw();
        } finally {
            if (saved[0] !== undefined) {
                this.pdf = saved[0];
            }
            this.ctm = saved[1];
            this.area = saved[2];
            this.base = saved[3];
            this.origin = saved[4];
        }
    }

    private imageMatrix(): Matrix {
        // A form starts its own current matrix, but SVG 2 §13.6 measures a non-scaling stroke in the coordinates of the image.
        return this.geometry.concat(this.base, this.ctm);
    }

    private inDocument(styles: SvgStyles, width: number, height: number, context: ComputedStyle | undefined, box: Box | undefined, draw: () => void): void {
        const saved: readonly [SvgStyles, number, number, ComputedStyle | undefined, Box | undefined] = [this.styles, this.width, this.height, this.context, this.contextBox];
        this.styles = styles;
        this.width = width;
        this.height = height;
        this.setContext(context, box);
        try {
            draw();
        } finally {
            this.styles = saved[0];
            this.width = saved[1];
            this.height = saved[2];
            this.setContext(saved[3], saved[4]);
        }
    }

    private setContext(context: ComputedStyle | undefined, box: Box | undefined): void {
        if (context === undefined) {
            delete this.context;
        } else {
            this.context = context;
        }
        if (box === undefined) {
            delete this.contextBox;
        } else {
            this.contextBox = box;
        }
    }

    private transformed(matrix: Matrix, draw: () => void): void {
        // Through a projection the matrix goes into it, since PDF draws only affine maps; otherwise into the content, with
        // the scale, how many CSS pixels of the page a unit of the user space covers, for the precision of projections.
        const projection: Homography | undefined = this.projection;
        if (projection !== undefined) {
            this.projection = this.geometry.composeHomography(projection, this.geometry.planarHomography(matrix));
            try {
                draw();
            } finally {
                this.setProjection(projection);
            }
            return;
        }
        const saved: readonly [Matrix, number] = [this.ctm, this.scale];
        this.pdf.content.transform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
        this.ctm = this.geometry.concat(saved[0], matrix);
        this.scale = saved[1] * Math.sqrt(Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]));
        try {
            draw();
        } finally {
            this.ctm = saved[0];
            this.scale = saved[1];
        }
    }

    private render(node: SvgNode, parent: ComputedStyle): void {
        const styles: SvgStyles = this.styles;
        if (!styles.isSvg(node.element)) {
            return;
        }
        const name: string = styles.localName(node.element);
        if (NEVER_RENDERED.has(name) || !this.passes(node.element)) {
            return;
        }
        const style: ComputedStyle = styles.style(node, parent);
        if (this.keyword(style.values["display"]) === "none") {
            return;
        }
        switch (name) {
            case "g":
            case "switch":
                this.effects(node, style, SvgGeometry.IDENTITY, () => this.children(node, style, name === "switch"));
                break;
            case "a":
                this.effects(node, style, SvgGeometry.IDENTITY, () => {
                    this.children(node, style, false);
                    this.anchor(node, style);
                });
                break;
            case "svg": {
                const viewport: Box = this.rectangle(style);
                this.effects(node, style, SvgGeometry.IDENTITY, () => this.viewport(node, style, viewport, undefined));
                break;
            }
            case "use":
                this.use(node, style);
                break;
            case "image":
                this.effects(node, style, SvgGeometry.IDENTITY, () => this.image(node, style));
                break;
            case "text":
                this.effects(node, style, SvgGeometry.IDENTITY, () => {
                    this.text.paint(node, style, false);
                    this.textLinks(node, style);
                });
                break;
            case "foreignObject":
                throw new Error("The painting of the foreignObject element in the SVG image " + styles.url + " is not implemented");
            default:
                if (SHAPES.has(name)) {
                    this.effects(node, style, SvgGeometry.IDENTITY, () => this.shape(node, style));
                }
        }
    }

    private children(node: SvgNode, style: ComputedStyle, first: boolean): void {
        // SVG 2 §5.6.3: a switch renders only its first direct child whose conditions are true.
        for (const element of node.element.getChildren()) {
            if (first && !(this.styles.isSvg(element) && this.passes(element))) {
                continue;
            }
            this.render({ element, parent: node }, style);
            if (first) {
                return;
            }
        }
    }

    private anchor(node: SvgNode, style: ComputedStyle): void {
        // SVG 2 §16.2: the area of the link is that of the content that the a element renders.
        const href: string | undefined = this.styles.href(node.element);
        const box: Box | undefined = href === undefined || this.collecting || this.quiet > 0 ? undefined : this.bbox(node, style, "decorated");
        if (href !== undefined && box !== undefined) {
            this.addLink(href, box);
        }
    }

    private textLinks(node: SvgNode, style: ComputedStyle): void {
        // An a element inside text links the characters that it holds, which are not boxes of their own.
        if (this.collecting || this.quiet > 0) {
            return;
        }
        const visit: (element: XMLElement) => void = (element: XMLElement): void => {
            for (const child of element.getChildren()) {
                if (!this.styles.isSvg(child)) {
                    continue;
                }
                const name: string = this.styles.localName(child);
                if (name !== "a" && name !== "tspan" && name !== "textPath") {
                    continue;
                }
                const href: string | undefined = name === "a" ? this.styles.href(child) : undefined;
                const box: Box | undefined = href === undefined ? undefined : this.text.bbox(node, style, child);
                if (href !== undefined && box !== undefined) {
                    this.addLink(href, box);
                }
                visit(child);
            }
        };
        visit(node.element);
    }

    private addLink(href: string, box: Box): void {
        if (this.collecting || this.quiet > 0) {
            return;
        }
        const target: readonly [string, boolean] | undefined = this.images.link(this.styles.resolve(href), this.styles.url);
        if (target !== undefined) {
            this.addArea(box, target[0], target[1]);
        }
    }

    private addArea(box: Box, name: string, internal: boolean): void {
        // A box of the user space in the viewport of the image, whose y goes down; through a projection the box is the one that
        // bounds the projected rectangle.
        let bounds: Box | undefined = box;
        if (this.projection !== undefined) {
            bounds = undefined;
            for (const polygon of this.geometry.projected(this.geometry.rectangle(box[0], box[1], box[2], box[3], 0, 0), this.projection, this.tolerance())) {
                for (const point of polygon) {
                    bounds = this.geometry.union(bounds, [point[0], point[1], 0, 0]);
                }
            }
        }
        if (bounds === undefined) {
            return;
        }
        const mapped: Box = this.geometry.transformBox(this.geometry.concat(this.origin, this.ctm), bounds);
        if (mapped[2] > 0 && mapped[3] > 0) {
            this.links.push([{ x: mapped[0], y: this.formHeight - mapped[1] - mapped[3], width: mapped[2], height: mapped[3] }, name, internal]);
        }
    }

    private quietly(draw: () => void): void {
        // Content that only a mask, a pattern or a marker shows is not a place to click, and a pattern draws it many times.
        this.quiet++;
        try {
            draw();
        } finally {
            this.quiet--;
        }
    }

    private passes(element: XMLElement): boolean {
        // SVG 2 §5.6.4 and §5.6.5: CSSMedia supports no extension, and a PDF has no user language preference to match.
        return this.styles.attribute(element, "requiredExtensions") === undefined && this.styles.attribute(element, "systemLanguage") === undefined;
    }

    private viewport(node: SvgNode, style: ComputedStyle, box: Box, reference: readonly [number | undefined, number | undefined] | undefined): void {
        // SVG 2 §8.2, §8.8 and §3.11: the viewBox fitted into the viewport, which clips unless overflow lets it show; §5.4.1:
        // the reference point of a symbol goes to the x and y of its viewport.
        const placement: readonly [Matrix, number, number] | undefined = this.placement(node.element, box, reference);
        if (placement === undefined) {
            return;
        }
        this.pdf.content.save();
        if (!this.clips(style) || this.clipTo(this.geometry.rectangle(box[0], box[1], box[2], box[3], 0, 0))) {
            this.transformed(placement[0], () => this.inDocument(this.styles, placement[1], placement[2], this.context, this.contextBox,
                () => this.children(node, style, false)));
        }
        this.pdf.content.restore();
    }

    private placement(element: XMLElement, box: Box, reference: readonly [number | undefined, number | undefined] | undefined): readonly [Matrix, number, number] | undefined {
        // The matrix from the viewport's content to the space around it, and the size its percentages refer to.
        const viewBox: Box | undefined = this.geometry.viewBox(this.styles.attribute(element, "viewBox"));
        if (box[2] <= 0 || box[3] <= 0 || (viewBox !== undefined && (viewBox[2] === 0 || viewBox[3] === 0))) {
            return undefined;
        }
        let matrix: Matrix = viewBox === undefined ? this.geometry.translation(box[0], box[1])
            : this.geometry.fit(viewBox, this.styles.attribute(element, "preserveAspectRatio"), box[0], box[1], box[2], box[3]);
        if (reference !== undefined) {
            const point: readonly [number, number] = this.geometry.point(matrix, reference[0] ?? 0, reference[1] ?? 0);
            matrix = this.geometry.concat(this.geometry.translation(reference[0] === undefined ? 0 : box[0] - point[0], reference[1] === undefined ? 0 : box[1] - point[1]), matrix);
        }
        return [matrix, viewBox?.[2] ?? box[2], viewBox?.[3] ?? box[3]];
    }

    private clips(style: ComputedStyle): boolean {
        return CLIPPING_OVERFLOW.has(this.keyword(style.values["overflow-x"]) ?? "") || CLIPPING_OVERFLOW.has(this.keyword(style.values["overflow-y"]) ?? "");
    }

    private rectangle(style: ComputedStyle): Box {
        // SVG 2 §5.1.4: an auto width or height is 100%.
        const values: Readonly<Record<string, CssValue>> = style.values;
        return [this.styles.pixels(values["x"], this.width), this.styles.pixels(values["y"], this.height),
            this.keyword(values["width"]) === "auto" ? this.width : this.styles.pixels(values["width"], this.width),
            this.keyword(values["height"]) === "auto" ? this.height : this.styles.pixels(values["height"], this.height)];
    }

    private effects(node: SvgNode, style: ComputedStyle, after: Matrix, draw: () => void): void {
        // SVG 2 §3.6: the transforms, then clipping and masking, then the group composited with its opacity and blend mode.
        // CSS Transforms 2 §4.1: an element in a 3D rendering context goes into the plane of its own or its parent's.
        const filter: CssValue | undefined = style.values["filter"];
        if (filter !== undefined && this.keyword(filter) !== "none") {
            throw new Error("The painting of the filter property in the SVG image " + this.styles.url + " is not implemented");
        }
        const own: Matrix4 = this.geometry.multiply4(this.geometry.multiply4(this.perspective(node), this.spatial(node, style)), this.geometry.lift(after));
        if (this.space !== undefined) {
            this.participate(node, style, own, draw);
            return;
        }
        if (this.keyword(style.values["backface-visibility"]) === "hidden" && own[10] < 0) {
            return;
        }
        if (this.preserves(style)) {
            const planes: Array<Plane | undefined> = [];
            this.ownPlane(node, style, own, draw, planes);
            this.drawPlanes(planes);
            return;
        }
        this.flat(node, style, own, draw);
    }

    private flat(node: SvgNode, style: ComputedStyle, matrix: Matrix4, draw: () => void): void {
        // CSS Transforms 2 §4.1: a flat element is drawn with its transform, which is affine unless it has a perspective;
        // then all that the element draws goes through the projection of its plane.
        const flat: Matrix | null | undefined = this.geometry.flatten(matrix);
        if (flat === null) {
            return;
        }
        this.pdf.content.save();
        if (flat !== undefined) {
            this.transformed(flat, () => this.composite(node, style, draw, true));
        } else {
            this.projected(matrix, () => this.composite(node, style, draw, true));
        }
        this.pdf.content.restore();
    }

    private projected(matrix: Matrix4, draw: () => void): void {
        const saved: Homography | undefined = this.projection;
        this.projection = this.geometry.composeHomography(saved ?? SvgGeometry.IDENTITY3, this.geometry.homography(matrix));
        try {
            draw();
        } finally {
            this.setProjection(saved);
        }
    }

    private setProjection(projection: Homography | undefined): void {
        if (projection === undefined) {
            delete this.projection;
        } else {
            this.projection = projection;
        }
    }

    isProjected(): boolean {
        return this.projection !== undefined;
    }

    isCollecting(): boolean {
        return this.collecting;
    }

    tolerance(): number {
        return FLATNESS / this.scale;
    }

    placed(matrix: Matrix): readonly [Matrix, number] | undefined {
        // A glyph stays text through a projection: its text matrix takes the projection's tangent at the glyph's origin, the
        // affine map nearest to it there, and the scale of that map is the one of its stroke.
        const projection: Homography | undefined = this.projection;
        if (projection === undefined) {
            return [matrix, 1];
        }
        const origin: readonly [number, number] = this.geometry.point(matrix, 0, 0);
        const tangent: Matrix | undefined = this.geometry.tangent(projection, origin[0], origin[1]);
        return tangent === undefined ? undefined : [this.geometry.concat(tangent, matrix), Math.sqrt(Math.abs(tangent[0] * tangent[3] - tangent[1] * tangent[2]))];
    }

    scaledStroke(style: ComputedStyle, scale: number): void {
        // A stroke's width and dashes are in user space, which the projection scales differently at each glyph.
        this.pdf.content.lineWidth(this.strokeWidth(style) * scale);
        const dashes: readonly [ReadonlyArray<number>, number] | undefined = this.dashes(undefined, style);
        if (dashes !== undefined) {
            this.pdf.content.dash(dashes[0].map((length: number) => length * scale), dashes[1] * scale);
        }
    }

    private composite(node: SvgNode, style: ComputedStyle, draw: () => void, blending: boolean): void {
        // CSS Masking 1 and Compositing 1: clipping and masking, then the opacity and blend mode of the group, unless the
        // caller applies them; each soft mask applies to a group of its own, so that the masks inside cannot replace it.
        if (this.collecting) {
            draw();
            return;
        }
        const clip: ImageResource | null | undefined = this.clipMask(style.values["clip-path"], node, style);
        const mask: readonly [ImageResource, boolean] | null | undefined = clip === null ? null : this.mask(node, style);
        const opacity: number = blending ? this.fraction(style.values["opacity"]) : 1;
        const blend: string = blending ? this.blendMode(style) : "Normal";
        if (clip === null || mask === null || opacity <= 0) {
            return;
        }
        if (clip === undefined && mask === undefined && opacity === 1 && blend === "Normal" && (!blending || this.keyword(style.values["isolation"]) !== "isolate")) {
            draw();
            return;
        }
        let group: ImageResource | undefined = this.group(draw);
        if (group !== undefined && mask !== undefined) {
            const masked: ImageResource = group;
            group = this.group(() => {
                this.pdf.content.graphicsState(this.pdf.useMask(mask[0].object, mask[1]));
                this.pdf.content.paintXObject(this.pdf.useImage(masked));
            });
        }
        if (group !== undefined) {
            if (clip !== undefined) {
                this.pdf.content.graphicsState(this.pdf.useMask(clip.object, true));
            }
            this.pdf.content.graphicsState(this.pdf.useState(opacity, opacity, blend));
            this.pdf.content.paintXObject(this.pdf.useImage(group));
        }
    }

    private blendMode(style: ComputedStyle): string {
        return BLEND_MODES[this.keyword(style.values["mix-blend-mode"]) ?? "normal"] ?? "Normal";
    }

    private preserves(style: ComputedStyle): boolean {
        // CSS Transforms 2 §7.1: a grouping property makes the used value of transform-style flat.
        const values: Readonly<Record<string, CssValue>> = style.values;
        const overflow: boolean = ["overflow-x", "overflow-y"].some((property: string) => !["visible", "clip"].includes(this.keyword(values[property]) ?? "visible"));
        const set: (property: string) => boolean = (property: string): boolean => values[property] !== undefined && this.keyword(values[property]) !== "none";
        return this.keyword(values["transform-style"]) === "preserve-3d" && !overflow && this.fraction(values["opacity"]) >= 1 && !set("filter") && !set("clip-path")
            && this.keyword(values["isolation"]) !== "isolate" && !set("mask-image") && !set("mask") && this.blendMode(style) === "Normal";
    }

    private participate(node: SvgNode, style: ComputedStyle, own: Matrix4, draw: () => void): void {
        // CSS Transforms 2 §4.1.2 and §4.1.4: a 3D-transformed element has a plane of its own, left out of its parent's; any
        // other is drawn in its parent's plane, its children staying in the context only if it extends it.
        const [planes, matrix, painting]: Space = this.space as Space;
        if (!this.geometry.planar(this.spatial(node, style))) {
            if (painting) {
                return;
            }
            const accumulated: Matrix4 = this.geometry.multiply4(this.geometry.multiply4(matrix, this.geometry.lift(this.ctm)), own);
            if (this.keyword(style.values["backface-visibility"]) !== "hidden" || accumulated[10] >= 0) {
                this.ownPlane(node, style, accumulated, draw, planes);
            }
            return;
        }
        this.inSpace(this.preserves(style) ? this.space : undefined, () => this.flat(node, style, own, draw));
    }

    private inSpace(space: Space | undefined, draw: () => void): void {
        const saved: Space | undefined = this.space;
        if (space === undefined) {
            delete this.space;
        } else {
            this.space = space;
        }
        try {
            draw();
        } finally {
            if (saved === undefined) {
                delete this.space;
            } else {
                this.space = saved;
            }
        }
    }

    private ownPlane(node: SvgNode, style: ComputedStyle, matrix: Matrix4, draw: () => void, planes: Array<Plane | undefined>): void {
        // The plane takes its place in painting order before those of its descendants, which going through its content finds
        // when it extends the context; it is painted later, in depth order, from its content again.
        const source: Box | undefined = this.bbox(node, style, "ink");
        if (source === undefined) {
            return;
        }
        const index: number = planes.length;
        planes.push(undefined);
        const preserves: boolean = this.preserves(style);
        const state: State = this.state();
        if (preserves) {
            this.collect(() => this.inSpace([planes, matrix, false], draw));
        }
        planes[index] = [() => this.restored(state, () => this.inSpace(preserves ? [planes, matrix, true] : undefined,
            () => this.projected(matrix, () => this.composite(node, style, draw, true)))), source, matrix];
    }

    private collect(draw: () => void): void {
        // Nothing is drawn while the content is gone through for its planes, so it goes to a page that is never written, in
        // the plane's own coordinates.
        const saved: readonly [PdfPage, Matrix, Homography | undefined] = [this.pdf, this.ctm, this.projection];
        const collecting: boolean = this.collecting;
        this.pdf = new PdfPage(0, 0, 0);
        this.ctm = SvgGeometry.IDENTITY;
        delete this.projection;
        this.collecting = true;
        try {
            draw();
        } finally {
            this.pdf = saved[0];
            this.ctm = saved[1];
            this.setProjection(saved[2]);
            this.collecting = collecting;
        }
    }

    private state(): State {
        return [this.styles, this.width, this.height, this.context, this.contextBox, new Set<XMLElement>(this.active)];
    }

    private restored(state: State, draw: () => void): void {
        const saved: State = this.state();
        const apply: (target: State) => void = (target: State): void => {
            this.styles = target[0];
            this.width = target[1];
            this.height = target[2];
            this.setContext(target[3], target[4]);
            this.active.clear();
            target[5].forEach((element: XMLElement) => this.active.add(element));
        };
        apply(state);
        try {
            draw();
        } finally {
            apply(saved);
        }
    }

    private within(matrix: Matrix4, draw: () => void): void {
        const flat: Matrix | null | undefined = this.geometry.flatten(matrix);
        if (flat === null) {
            return;
        }
        if (flat !== undefined) {
            this.transformed(flat, draw);
        } else {
            this.projected(matrix, draw);
        }
    }

    private drawPlanes(planes: ReadonlyArray<Plane | undefined>): void {
        // CSS Transforms 2 §4.1.2: the planes from back to front, cut where they cross, coplanar ones in painting order.
        const facets: Array<Facet> = [];
        planes.forEach((plane: Plane | undefined, index: number) => {
            if (plane === undefined) {
                return;
            }
            const points: Array<readonly [number, number, number]> = this.geometry.facet(plane[2], plane[1]);
            if (points.length >= 3) {
                facets.push([index, points]);
            }
        });
        for (const [index, points] of this.geometry.depthOrder(facets)) {
            const plane: Plane = planes[index] as Plane;
            this.pdf.content.save();
            if (this.clipTo(this.geometry.polygonPath(points.map((point: readonly [number, number, number]): readonly [number, number] => [point[0], point[1]])))) {
                plane[0]();
            }
            this.pdf.content.restore();
        }
    }

    outline(path: SvgPath): boolean {
        const projection: Homography | undefined = this.projection;
        if (projection === undefined) {
            this.geometry.emit(path, undefined, this.pdf.content);
            return path.verbs.length > 0;
        }
        const polygons: Array<Array<readonly [number, number]>> = this.geometry.projected(path, projection, this.tolerance());
        for (const polygon of polygons) {
            polygon.forEach((point: readonly [number, number], index: number) => {
                if (index === 0) {
                    this.pdf.content.moveTo(point[0], point[1]);
                } else {
                    this.pdf.content.lineTo(point[0], point[1]);
                }
            });
            this.pdf.content.closePath();
        }
        return polygons.length > 0;
    }

    private clipTo(path: SvgPath): boolean {
        if (!this.outline(path)) {
            return false;
        }
        this.pdf.content.clip(false);
        return true;
    }

    painted(evenOdd: boolean): void {
        const tiling: (() => void) | undefined = this.tiling;
        if (tiling === undefined) {
            this.pdf.content.fill(evenOdd);
            return;
        }
        delete this.tiling;
        this.pdf.content.clip(evenOdd);
        tiling();
    }

    masked(draw: () => void): boolean {
        // Text cannot be a clipping path for its stroke, so the tiles go under a mask of the text in white.
        const tiling: (() => void) | undefined = this.tiling;
        if (tiling === undefined) {
            return false;
        }
        delete this.tiling;
        const area: Box | undefined = this.localArea();
        if (area === undefined) {
            return true;
        }
        const form: PdfPage = this.document.startForm(area[2], area[3], false);
        this.drawIn(form, SvgGeometry.IDENTITY, area, () => {
            const gray: string = this.pdf.useColorSpace(PdfColorSpaces.GRAY);
            this.pdf.content.fillSpace(gray);
            this.pdf.content.fillColor([1]);
            this.pdf.content.strokeSpace(gray);
            this.pdf.content.strokeColor([1]);
            draw();
        });
        this.pdf.content.graphicsState(this.pdf.useMask(this.document.finishForm(form, area, SvgGeometry.IDENTITY).object, true));
        tiling();
        return true;
    }

    private group(draw: () => void): ImageResource | undefined {
        // A group is a form in the current user space, bounded by the part of the image it can reach.
        const area: Box | undefined = this.localArea();
        if (area === undefined) {
            return undefined;
        }
        const form: PdfPage = this.document.startForm(area[2], area[3], false);
        this.drawIn(form, SvgGeometry.IDENTITY, area, draw);
        return this.document.finishForm(form, area, SvgGeometry.IDENTITY);
    }

    private localArea(): Box | undefined {
        const inverse: Matrix | undefined = this.geometry.invert(this.ctm);
        return inverse === undefined ? undefined : this.geometry.transformBox(inverse, this.area);
    }

    private spatial(node: SvgNode, style: ComputedStyle): Matrix4 {
        // CSS Transforms 2 §11: on clipPath, the gradients and pattern a transform with three-dimensional functions is ignored.
        const values: Readonly<Record<string, CssValue>> = style.values;
        if (["transform", "translate", "rotate", "scale"].every((property: string) => values[property] === undefined || this.keyword(values[property]) === "none")) {
            return SvgGeometry.IDENTITY4;
        }
        const matrix: Matrix4 = this.geometry.spatial(values, this.reference(node, style));
        return FLAT_TRANSFORMS.has(this.styles.localName(node.element)) && !this.geometry.planar(matrix) ? SvgGeometry.IDENTITY4 : matrix;
    }

    private transform(node: SvgNode, style: ComputedStyle): Matrix {
        // The transform of an element that cannot have a three-dimensional one.
        return this.geometry.flatten(this.spatial(node, style)) ?? SvgGeometry.IDENTITY;
    }

    private reference(node: SvgNode, style: ComputedStyle): Box {
        // CSS Transforms 1 §6.1: transform-box view-box is the viewport of the element's user space, fill-box and content-box
        // its object bounding box, and stroke-box and border-box its stroke bounding box.
        const box: string = this.keyword(style.values["transform-box"]) ?? "view-box";
        return box === "view-box" ? [0, 0, this.width, this.height] : this.bbox(node, style, box === "stroke-box" || box === "border-box" ? "stroke" : "fill") ?? [0, 0, 0, 0];
    }

    private perspective(node: SvgNode): Matrix4 {
        // CSS Transforms 2 §4.1.1: the perspective of the parent, about its perspective-origin in its reference box.
        const parent: SvgNode | undefined = node.parent;
        if (parent === undefined || FLAT_TRANSFORMS.has(this.styles.localName(parent.element))) {
            return SvgGeometry.IDENTITY4;
        }
        const style: ComputedStyle = this.styles.style(parent);
        const distance: CssValue | undefined = style.values["perspective"];
        if (distance === undefined || this.keyword(distance) === "none") {
            return SvgGeometry.IDENTITY4;
        }
        const box: Box = this.reference(parent, style);
        const value: CssValue | undefined = style.values["perspective-origin"];
        const tokens: ReadonlyArray<CssValue> = value === undefined ? [] : (value.kind === "list" ? value.items : [value]);
        const origin: readonly [number, number] = this.geometry.position(tokens, box[2], box[3], this.keyword(style.values["direction"]) === "rtl");
        const x: number = box[0] + origin[0];
        const y: number = box[1] + origin[1];
        const shifted: Matrix4 = this.geometry.multiply4(this.geometry.lift([1, 0, 0, 1, x, y]), this.geometry.perspective4(this.styles.pixels(distance, 0)));
        return this.geometry.multiply4(shifted, this.geometry.lift([1, 0, 0, 1, -x, -y]));
    }

    private use(node: SvgNode, style: ComputedStyle): void {
        // SVG 2 §5.5: the referenced element is rendered as an instance that inherits from the use element, moved by x and
        // y; a reference to an ancestor, or a cycle, is in error.
        const target: readonly [XMLElement, SvgStyles] | undefined = this.target(node.element);
        if (target === undefined || this.active.has(target[0]) || !target[1].isSvg(target[0])) {
            return;
        }
        for (let ancestor: SvgNode | undefined = node; ancestor !== undefined; ancestor = ancestor.parent) {
            if (ancestor.element === target[0]) {
                return;
            }
        }
        const [element, styles]: readonly [XMLElement, SvgStyles] = target;
        const instance: SvgNode = { element };
        const name: string = styles.localName(element);
        const translation: Matrix = this.geometry.translation(this.styles.pixels(style.values["x"], this.width), this.styles.pixels(style.values["y"], this.height));
        const size: readonly [number, number] = [this.styles.pixels(style.values["width"], this.width), this.styles.pixels(style.values["height"], this.height)];
        this.guarded(element, () => this.effects(node, style, translation, () => this.inDocument(styles, this.width, this.height, this.context, this.contextBox, () => {
            if (name !== "symbol" && name !== "svg") {
                this.render(instance, style);
                return;
            }
            const instanceStyle: ComputedStyle = styles.style(instance, style);
            const [box, reference]: readonly [Box, readonly [number | undefined, number | undefined] | undefined] = this.usedViewport(instance, instanceStyle, style, size);
            this.effects(instance, instanceStyle, SvgGeometry.IDENTITY, () => this.viewport(instance, instanceStyle, box, reference));
        })));
    }

    private usedViewport(instance: SvgNode, style: ComputedStyle, useStyle: ComputedStyle, size: readonly [number, number]): readonly [Box, readonly [number | undefined, number | undefined] | undefined] {
        // SVG 2 §5.5.2: the width and height of the use element, unless auto, replace those of an svg or symbol; §5.4.1: a
        // symbol has a reference point.
        const element: XMLElement = instance.element;
        const own: Box = this.rectangle(style);
        const reference: readonly [number | undefined, number | undefined] | undefined = this.styles.localName(element) === "symbol"
            ? [this.referencePoint(element, "refX", own[2], style), this.referencePoint(element, "refY", own[3], style)] : undefined;
        return [[own[0], own[1], this.keyword(useStyle.values["width"]) === "auto" ? own[2] : size[0], this.keyword(useStyle.values["height"]) === "auto" ? own[3] : size[1]], reference];
    }

    private referencePoint(element: XMLElement, attribute: string, size: number, style: ComputedStyle): number | undefined {
        // SVG 2 §13.7.1: left, center and right, or top, center and bottom, are 0%, 50% and 100%.
        const value: string | undefined = this.styles.attribute(element, attribute);
        if (value === undefined) {
            return undefined;
        }
        const keyword: number | undefined = REFERENCE_KEYWORDS[value.trim()];
        return keyword !== undefined ? keyword * size : this.styles.length(value, style, size);
    }

    target(element: XMLElement): readonly [XMLElement, SvgStyles] | undefined {
        const href: string | undefined = this.styles.href(element);
        return href === undefined ? undefined : this.lookup(href);
    }

    lookup(href: string): readonly [XMLElement, SvgStyles] | undefined {
        // SVG 2 §5.5 and §16.1.3: a reference without a fragment names the root of the referenced document.
        const url: string = this.styles.resolve(href);
        const hash: number = url.indexOf("#");
        const address: string = hash < 0 ? url : url.substring(0, hash);
        const fragment: string = hash < 0 ? "" : BaseUrls.percentDecoded(url.substring(hash + 1)).toString("utf8");
        const styles: SvgStyles | undefined = address === this.styles.url.split("#")[0] ? this.styles : this.images.styles(address);
        const element: XMLElement | undefined = styles === undefined ? undefined : (fragment.length === 0 ? styles.root : styles.element(fragment));
        return element === undefined || styles === undefined ? undefined : [element, styles];
    }

    private guarded(element: XMLElement, draw: () => void): void {
        if (this.active.has(element)) {
            return;
        }
        this.active.add(element);
        try {
            draw();
        } finally {
            this.active.delete(element);
        }
    }

    private shape(node: SvgNode, style: ComputedStyle): void {
        // SVG 2 §13.8: the fill, the stroke and the markers, in the order paint-order gives.
        const path: SvgPath | undefined = this.path(node, style);
        if (path === undefined || this.hidden(style)) {
            return;
        }
        for (const operation of this.paintOrder(style)) {
            if (operation === "fill") {
                if (this.styles.localName(node.element) !== "line") {
                    this.fill(path, node, style);
                }
            } else if (operation === "stroke") {
                this.stroke(path, node, style);
            } else {
                this.markers(path, node, style);
            }
        }
    }

    hidden(style: ComputedStyle): boolean {
        const visibility: string | undefined = this.keyword(style.values["visibility"]);
        return visibility === "hidden" || visibility === "collapse";
    }

    paintOrder(style: ComputedStyle): Array<string> {
        const value: CssValue | undefined = style.values["paint-order"];
        const named: Array<string> = (value === undefined ? [] : (value.kind === "list" ? value.items : [value]))
            .map((item: CssValue) => this.keyword(item) ?? "").filter((name: string) => name === "fill" || name === "stroke" || name === "markers");
        return [...named, ...["fill", "stroke", "markers"].filter((name: string) => !named.includes(name))];
    }

    private path(node: SvgNode, style: ComputedStyle): SvgPath | undefined {
        // SVG 2 §10: the equivalent path of each shape; a size of zero disables its rendering.
        const styles: SvgStyles = this.styles;
        const values: Readonly<Record<string, CssValue>> = style.values;
        switch (styles.localName(node.element)) {
            case "rect": {
                const box: Box = [styles.pixels(values["x"], this.width), styles.pixels(values["y"], this.height),
                    this.keyword(values["width"]) === "auto" ? 0 : styles.pixels(values["width"], this.width),
                    this.keyword(values["height"]) === "auto" ? 0 : styles.pixels(values["height"], this.height)];
                if (box[2] <= 0 || box[3] <= 0) {
                    return undefined;
                }
                // §10.2: "A computed value of zero for either dimension" gives "a rectangle without corner rounding".
                const [rx, ry]: readonly [number, number] = this.radii(values["rx"], values["ry"], box[2], box[3]);
                return rx === 0 || ry === 0 ? this.geometry.rectangle(box[0], box[1], box[2], box[3], 0, 0)
                    : this.geometry.rectangle(box[0], box[1], box[2], box[3], Math.min(rx, box[2] / 2), Math.min(ry, box[3] / 2));
            }
            case "circle": {
                const r: number = styles.pixels(values["r"], Math.hypot(this.width, this.height) / Math.SQRT2);
                return r <= 0 ? undefined : this.geometry.ellipse(styles.pixels(values["cx"], this.width), styles.pixels(values["cy"], this.height), r, r);
            }
            case "ellipse": {
                const [rx, ry]: readonly [number, number] = this.radii(values["rx"], values["ry"], this.width, this.height);
                return rx <= 0 || ry <= 0 ? undefined : this.geometry.ellipse(styles.pixels(values["cx"], this.width), styles.pixels(values["cy"], this.height), rx, ry);
            }
            case "line": {
                const coordinate: (attribute: string, basis: number) => number = (attribute: string, basis: number): number =>
                    styles.length(styles.attribute(node.element, attribute) ?? "0", style, basis) ?? 0;
                return this.geometry.parse("M" + coordinate("x1", this.width) + " " + coordinate("y1", this.height) + "L" + coordinate("x2", this.width) + " " + coordinate("y2", this.height));
            }
            case "polyline":
            case "polygon": {
                const points: string | undefined = styles.attribute(node.element, "points");
                return points === undefined ? undefined : this.geometry.points(points, styles.localName(node.element) === "polygon");
            }
            default: {
                const d: CssValue | undefined = values["d"];
                const data: CssValue | undefined = d !== undefined && d.kind === "function" && d.name.toLowerCase() === "path" ? d.args[d.args.length - 1] : d;
                const path: SvgPath | undefined = data !== undefined && data.kind === "string" ? this.geometry.parse(data.value) : undefined;
                return path === undefined || path.verbs.length === 0 ? undefined : path;
            }
        }
    }

    private radii(rx: CssValue | undefined, ry: CssValue | undefined, width: number, height: number): readonly [number, number] {
        // SVG 2 §10.2: an auto radius takes the other one, and both auto are zero.
        const autoX: boolean = rx === undefined || this.keyword(rx) === "auto";
        const autoY: boolean = ry === undefined || this.keyword(ry) === "auto";
        if (autoX && autoY) {
            return [0, 0];
        }
        const x: number = autoX ? this.styles.pixels(ry, height) : this.styles.pixels(rx, width);
        return [x, autoY ? x : this.styles.pixels(ry, height)];
    }

    private fill(path: SvgPath, node: SvgNode, style: ComputedStyle): void {
        // A shape grown by the thin stroke is one path only for nonzero; with evenodd the stroke around it is filled apart.
        const evenOdd: boolean = this.keyword(style.values["fill-rule"]) === "evenodd";
        const shapes: ReadonlyArray<readonly [SvgPath, boolean]> = this.growth <= 0 ? [[path, evenOdd]] : (evenOdd
            ? [[path, true], [this.geometry.strokeOutline(path, this.thinStroke(), this.tolerance(), PathGeometry.IDENTITY3), false]]
            : [[this.geometry.thickened(path, this.thinStroke(), this.tolerance()), false]]);
        for (const [shape, rule] of shapes) {
            this.pdf.content.save();
            if (this.paintWith(style.values["fill"], this.fraction(style.values["fill-opacity"]), false, node, style, undefined) && this.outline(shape)) {
                this.painted(rule);
            }
            this.pdf.content.restore();
        }
    }

    private thinStroke(): StrokeStyle {
        // CSS Fonts 4 §2.8: "a thin stroke around each glyph", with the initial stroke-linejoin and stroke-miterlimit (SVG 2 §13.5).
        return { width: this.growth, cap: "butt", extension: "miter", shape: "fallback", limit: MITER_LIMIT };
    }

    private stroke(path: SvgPath, node: SvgNode, style: ComputedStyle): void {
        // SVG 2 §13.6: a non-scaling stroke is drawn in the coordinates of the image, not of the element; through a projection
        // the stroke's shape is filled, since the projection changes its width from place to place.
        this.pdf.content.save();
        const projected: boolean = this.projection !== undefined;
        const nonScaling: boolean = this.keyword(style.values["vector-effect"]) === "non-scaling-stroke";
        const grown: boolean = this.growth > 0 && !projected && !nonScaling;
        if (this.paintWith(style.values["stroke"], this.fraction(style.values["stroke-opacity"]), !projected && !grown, node, style, undefined)) {
            if (grown) {
                if (this.grownStroke(path, style)) {
                    this.painted(false);
                }
            } else if (projected) {
                if (this.strokeArea(path, style)) {
                    this.painted(false);
                }
            } else {
                const inverse: Matrix | undefined = nonScaling ? this.geometry.invert(this.imageMatrix()) : undefined;
                if (inverse !== undefined) {
                    this.pdf.content.transform(inverse[0], inverse[1], inverse[2], inverse[3], inverse[4], inverse[5]);
                }
                if (this.strokeStyle(style, path)) {
                    this.geometry.emit(path, inverse === undefined ? undefined : this.imageMatrix(), this.pdf.content);
                    this.pdf.content.stroke();
                }
            }
        }
        this.pdf.content.restore();
    }

    private grownStroke(path: SvgPath, style: ComputedStyle): boolean {
        // A wider stroke would not grow the ends of butt caps or the corners of bevel joins as the thin stroke does.
        const width: number = this.strokeWidth(style);
        const dashes: readonly [ReadonlyArray<number>, number] | undefined = this.dashes(path, style);
        if (width <= 0 || this.onlyEmptyDashes(dashes, style)) {
            return false;
        }
        const shape: SvgPath = this.geometry.strokeOutline(path, this.outlineStyle(style, width, dashes), this.tolerance(), SvgGeometry.IDENTITY3);
        return this.outline(this.geometry.thickened(shape, this.thinStroke(), this.tolerance()));
    }

    strokeArea(path: SvgPath, style: ComputedStyle): boolean {
        // SVG 2 §13.6: a non-scaling stroke is shaped in the coordinates of the image, where its width is given.
        const projection: Homography = this.projection as Homography;
        const width: number = this.strokeWidth(style);
        if (width <= 0) {
            return false;
        }
        const dashes: readonly [ReadonlyArray<number>, number] | undefined = this.dashes(path, style);
        if (this.onlyEmptyDashes(dashes, style)) {
            return false;
        }
        const stroke: StrokeStyle = this.outlineStyle(style, width, dashes);
        if (this.keyword(style.values["vector-effect"]) !== "non-scaling-stroke") {
            return this.outline(this.geometry.strokeOutline(path, stroke, this.tolerance(), projection));
        }
        const inverse: Matrix | undefined = this.geometry.invert(this.imageMatrix());
        if (inverse === undefined) {
            return false;
        }
        const tolerance: number = this.imageTolerance();
        const image: SvgPath = this.geometry.projectedLines(path, this.geometry.composeHomography(this.geometry.planarHomography(this.imageMatrix()), projection), tolerance);
        const shape: SvgPath = this.geometry.strokeOutline(image, stroke, tolerance, SvgGeometry.IDENTITY3);
        this.geometry.emit(this.geometry.transformPath(shape, inverse), undefined, this.pdf.content);
        return shape.verbs.length > 0;
    }

    private outlineStyle(style: ComputedStyle, width: number, dashes: readonly [ReadonlyArray<number>, number] | undefined): StrokeStyle {
        // SVG 2 §13.5.5 has three joins, which are miter fallback, crop round and crop bevel in CSS Fill and Stroke 3 §4.2.4.
        const limit: CssValue | undefined = style.values["stroke-miterlimit"];
        const join: readonly [string, string] = SHAPE_JOINS[this.keyword(style.values["stroke-linejoin"]) ?? "miter"] ?? SHAPE_JOINS["miter"];
        const stroke: StrokeStyle = {
            width, cap: this.keyword(style.values["stroke-linecap"]) ?? "butt", extension: join[0], shape: join[1],
            limit: Math.max(1, limit !== undefined && limit.kind === "number" ? limit.value : 4)
        };
        if (dashes !== undefined) {
            stroke.dashes = dashes;
        }
        return stroke;
    }

    strokeStyle(style: ComputedStyle, path: SvgPath | undefined): boolean {
        // SVG 2 §13.5: no stroke is painted without a width.
        const width: number = this.strokeWidth(style);
        const dashes: readonly [ReadonlyArray<number>, number] | undefined = this.dashes(path, style);
        if (width <= 0 || this.onlyEmptyDashes(dashes, style)) {
            return false;
        }
        this.pdf.content.lineWidth(width);
        this.pdf.content.lineCap(CAPS[this.keyword(style.values["stroke-linecap"]) ?? "butt"] ?? 0);
        this.pdf.content.lineJoin(JOINS[this.keyword(style.values["stroke-linejoin"]) ?? "miter"] ?? 0);
        const limit: CssValue | undefined = style.values["stroke-miterlimit"];
        this.pdf.content.miterLimit(Math.max(1, limit !== undefined && limit.kind === "number" ? limit.value : 4));
        if (dashes !== undefined) {
            this.pdf.content.dash(dashes[0], dashes[1]);
        }
        return true;
    }

    private buttCaps(style: ComputedStyle): boolean {
        return (this.keyword(style.values["stroke-linecap"]) ?? "butt") === "butt";
    }

    private onlyEmptyDashes(dashes: readonly [ReadonlyArray<number>, number] | undefined, style: ComputedStyle): boolean {
        return dashes !== undefined && this.buttCaps(style) && dashes[0].every((length: number, index: number) => index % 2 === 1 || length === 0);
    }

    private withoutEmptyDashes(lengths: ReadonlyArray<number>, offset: number, style: ComputedStyle): readonly [ReadonlyArray<number>, number] {
        // A zero-length dash is only its caps, and a butt cap has no area, yet a renderer may mark a line of pixels there, so its
        // place joins the gaps next to it; the pattern starts at a dash that remains, and the offset follows it.
        const first: number = lengths.findIndex((length: number, index: number) => index % 2 === 0 && length > 0);
        if (first < 0 || !this.buttCaps(style) || lengths.every((length: number, index: number) => index % 2 === 1 || length > 0)) {
            return [lengths, offset];
        }
        const merged: Array<number> = [];
        for (let step: number = 0; step < lengths.length; step += 2) {
            const at: number = (first + step) % lengths.length;
            if (lengths[at] > 0) {
                merged.push(lengths[at], lengths[at + 1]);
            } else {
                merged[merged.length - 1] += lengths[at + 1];
            }
        }
        const total: number = merged.reduce((sum: number, length: number) => sum + length, 0);
        const shift: number = lengths.slice(0, first).reduce((sum: number, length: number) => sum + length, 0);
        return [merged, ((offset - shift) % total + total) % total];
    }

    shapePath(node: SvgNode, style: ComputedStyle, styles: SvgStyles): SvgPath | undefined {
        let path: SvgPath | undefined;
        this.inDocument(styles, this.width, this.height, this.context, this.contextBox, () => {
            path = this.path(node, style);
        });
        return path;
    }

    elementTransform(node: SvgNode, style: ComputedStyle, styles: SvgStyles): Matrix4 {
        let matrix: Matrix4 = SvgGeometry.IDENTITY4;
        this.inDocument(styles, this.width, this.height, this.context, this.contextBox, () => {
            matrix = this.geometry.multiply4(this.perspective(node), this.spatial(node, style));
        });
        return matrix;
    }

    private strokeWidth(style: ComputedStyle): number {
        return this.styles.pixels(style.values["stroke-width"], Math.hypot(this.width, this.height) / Math.SQRT2);
    }

    private dashes(path: SvgPath | undefined, style: ComputedStyle): readonly [ReadonlyArray<number>, number] | undefined {
        // SVG 2 §13.5.6 and §9.6.2: an odd list repeats, a negative value or a zero sum turns dashing off, and path-length
        // scales the distances along the path.
        const value: CssValue | undefined = style.values["stroke-dasharray"];
        if (value === undefined || this.keyword(value) === "none") {
            return undefined;
        }
        const diagonal: number = Math.hypot(this.width, this.height) / Math.SQRT2;
        let lengths: Array<number> = (value.kind === "list" ? value.items : [value]).map((item: CssValue) => this.styles.pixels(item, diagonal));
        if (lengths.some((length: number) => length < 0) || lengths.reduce((sum: number, length: number) => sum + length, 0) <= 0) {
            return undefined;
        }
        if (lengths.length % 2 === 1) {
            lengths = [...lengths, ...lengths];
        }
        const authored: CssValue | undefined = style.values["path-length"];
        const pathLength: number | undefined = authored === undefined || this.keyword(authored) === "none" ? undefined : this.styles.pixels(authored, 0);
        if (pathLength === 0 && path !== undefined) {
            // §9.6.1: "A value of zero scaled infinitely must remain zero", and the rest become +Infinity, so the first length
            // above zero never ends.
            return lengths.findIndex((length: number) => length > 0) % 2 === 0 ? undefined : [[0, this.geometry.length(path, this.tolerance()) + 1], 0];
        }
        const scale: number = pathLength !== undefined && pathLength > 0 && path !== undefined ? this.geometry.length(path, this.tolerance()) / pathLength : 1;
        return this.withoutEmptyDashes(lengths.map((length: number) => length * scale), this.styles.pixels(style.values["stroke-dashoffset"], diagonal) * scale, style);
    }

    paintWith(value: CssValue | undefined, opacity: number, stroking: boolean, node: SvgNode, style: ComputedStyle, box: Box | undefined): boolean {
        // SVG 2 §13.2: none, a colour, context-fill and context-stroke, or a paint server with an optional fallback colour,
        // which a reference to anything but a paint server falls back to.
        delete this.tiling;
        const keyword: string | undefined = this.keyword(value);
        if (value === undefined || opacity <= 0 || keyword === "none" || this.collecting) {
            return false;
        }
        if (keyword === "context-fill" || keyword === "context-stroke") {
            const context: ComputedStyle | undefined = this.context;
            if (context === undefined) {
                return false;
            }
            const fill: boolean = keyword === "context-fill";
            return this.paintWith(context.values[fill ? "fill" : "stroke"], opacity * this.fraction(context.values[fill ? "fill-opacity" : "stroke-opacity"]), stroking,
                node, context, this.contextBox ?? [0, 0, 0, 0]);
        }
        const items: ReadonlyArray<CssValue> = value.kind === "list" ? value.items : [value];
        const url: CssValue | undefined = items.find((item: CssValue) => item.kind === "url");
        if (url === undefined || url.kind !== "url") {
            return this.color(value, style, opacity, stroking);
        }
        const target: readonly [XMLElement, SvgStyles] | undefined = this.lookup(url.href);
        const name: string = target === undefined || !target[1].isSvg(target[0]) ? "" : target[1].localName(target[0]);
        if (target !== undefined && (name === "linearGradient" || name === "radialGradient" || name === "pattern")) {
            const bounds: Box | undefined = box ?? this.bbox(node, style);
            return name === "pattern" ? this.pattern(target[0], target[1], opacity, stroking, bounds, this.projection === undefined ? undefined : this.bbox(node, style, "stroke"))
                : this.gradient(target[0], target[1], opacity, stroking, bounds);
        }
        const fallback: CssValue | undefined = items.find((item: CssValue) => item !== url);
        return fallback !== undefined && this.keyword(fallback) !== "none" && this.color(fallback, style, opacity, stroking);
    }

    private color(value: CssValue, style: ComputedStyle, opacity: number, stroking: boolean): boolean {
        const color: PdfColor | undefined = this.colors.color(value, style);
        if (color === undefined || color[2] * opacity <= 0) {
            return false;
        }
        this.setColor(color[0], color[1], stroking);
        this.alpha(color[2] * opacity, stroking);
        return true;
    }

    private setColor(space: ColorSpaceResource, components: ReadonlyArray<number>, stroking: boolean): void {
        const name: string = this.pdf.useColorSpace(space);
        if (stroking) {
            this.pdf.content.strokeSpace(name);
            this.pdf.content.strokeColor(components);
        } else {
            this.pdf.content.fillSpace(name);
            this.pdf.content.fillColor(components);
        }
    }

    private alpha(alpha: number, stroking: boolean): void {
        if (alpha < 1) {
            this.pdf.content.graphicsState(this.pdf.useState(stroking ? 1 : alpha, stroking ? alpha : 1, "Normal"));
        }
    }

    private usePattern(key: string, stroking: boolean): void {
        if (stroking) {
            this.pdf.content.strokePattern(key);
        } else {
            this.pdf.content.fillPattern(key);
        }
    }

    private chain(element: XMLElement, styles: SvgStyles, accepted: ReadonlyArray<string>): Array<readonly [XMLElement, SvgStyles]> {
        // SVG 2 §14.1.1: a paint server takes the attributes and the content it lacks from the one its href names.
        const chain: Array<readonly [XMLElement, SvgStyles]> = [];
        let current: readonly [XMLElement, SvgStyles] | undefined = [element, styles];
        while (current !== undefined && !chain.some((link: readonly [XMLElement, SvgStyles]) => link[0] === current?.[0])) {
            chain.push(current);
            const href: string | undefined = current[1].href(current[0]);
            const saved: SvgStyles = this.styles;
            this.styles = current[1];
            const next: readonly [XMLElement, SvgStyles] | undefined = href === undefined ? undefined : this.lookup(href);
            this.styles = saved;
            current = next !== undefined && next[1].isSvg(next[0]) && accepted.includes(next[1].localName(next[0])) ? next : undefined;
        }
        return chain;
    }

    private inherited(chain: ReadonlyArray<readonly [XMLElement, SvgStyles]>, attribute: string): readonly [string, XMLElement, SvgStyles] | undefined {
        for (const [element, styles] of chain) {
            const value: string | undefined = styles.attribute(element, attribute);
            if (value !== undefined) {
                return [value, element, styles];
            }
        }
        return undefined;
    }

    private unitLength(found: readonly [string, XMLElement, SvgStyles] | undefined, fallback: string, units: boolean, basis: number): number {
        // SVG 2 §8.11: in objectBoundingBox units a percentage is the same fraction as a number.
        const text: string = (found?.[0] ?? fallback).trim();
        if (units && text.endsWith("%")) {
            const value: number = Number(text.substring(0, text.length - 1));
            return Number.isFinite(value) ? value / 100 : 0;
        }
        const styles: SvgStyles = found?.[2] ?? this.styles;
        return styles.length(text, found === undefined ? styles.placed(styles.root)[1] : styles.placed(found[1])[1], basis) ?? 0;
    }

    private gradient(element: XMLElement, styles: SvgStyles, opacity: number, stroking: boolean, box: Box | undefined): boolean {
        // SVG 2 §14.2: the vector or circles in the units of gradientUnits, then gradientTransform, then the spread outside them.
        const linear: boolean = styles.localName(element) === "linearGradient";
        const chain: Array<readonly [XMLElement, SvgStyles]> = this.chain(element, styles, ["linearGradient", "radialGradient"]);
        const stops: Array<ColorStop> = [];
        const alphas: Array<ColorStop> = [];
        this.stops(chain, stops, alphas);
        const units: boolean = this.inherited(chain, "gradientUnits")?.[0] !== "userSpaceOnUse";
        if (stops.length === 0 || (units && (box === undefined || box[2] === 0 || box[3] === 0))) {
            return false;
        }
        const read: (attribute: string, fallback: string, basis: number) => number = (attribute: string, fallback: string, basis: number): number =>
            this.unitLength(this.inherited(chain, attribute), fallback, units, units ? 1 : basis);
        const diagonal: number = Math.hypot(this.width, this.height) / Math.SQRT2;
        let coordinates: Array<number>;
        if (linear) {
            coordinates = [read("x1", "0%", this.width), read("y1", "0%", this.height), read("x2", "100%", this.width), read("y2", "0%", this.height)];
        } else {
            const cx: number = read("cx", "50%", this.width);
            const cy: number = read("cy", "50%", this.height);
            coordinates = [this.inherited(chain, "fx") === undefined ? cx : read("fx", "50%", this.width), this.inherited(chain, "fy") === undefined ? cy : read("fy", "50%", this.height),
                read("fr", "0%", diagonal), cx, cy, read("r", "50%", diagonal)];
        }
        // §14.2.2.1 and §14.2.3.1: a gradient without length, and a single stop, paint the colour of the last stop.
        const degenerate: boolean = linear ? coordinates[0] === coordinates[2] && coordinates[1] === coordinates[3] : coordinates[5] <= 0;
        if (degenerate || stops.length === 1) {
            const last: number = stops.length - 1;
            this.setColor(PdfColorSpaces.RGB, stops[last].components, stroking);
            this.alpha(alphas[last].components[0] * opacity, stroking);
            return alphas[last].components[0] * opacity > 0;
        }
        // §14.2.3: "If the start circle fully overlaps with the end circle, no gradient is drawn"; ISO 32000-2 §8.7.4.5.4: a radial
        // shading already paints only the cone when neither circle contains the other, but it cannot repeat one.
        const centres: number = linear ? 0 : Math.hypot(coordinates[3] - coordinates[0], coordinates[4] - coordinates[1]);
        if (!linear && centres + coordinates[5] <= coordinates[2]) {
            return false;
        }
        const cone: boolean = !linear && centres + coordinates[2] > coordinates[5];
        const transformed: readonly [string, XMLElement, SvgStyles] | undefined = this.inherited(chain, "gradientTransform");
        const place: readonly [SvgNode, ComputedStyle] = (transformed?.[2] ?? styles).placed(transformed?.[1] ?? element);
        let local: Matrix = units && box !== undefined ? [box[2], 0, 0, box[3], box[0], box[1]] : SvgGeometry.IDENTITY;
        local = this.geometry.concat(local, this.transform(place[0], place[1]));
        const spread: string = this.inherited(chain, "spreadMethod")?.[0] ?? "pad";
        // SVG 2 §13.9: linearRGB is sRGB without its transfer function, a CalRGB space with a gamma of one.
        const linearRgb: boolean = this.keyword(styles.placed(element)[1].values["color-interpolation"]) === "linearrgb";
        const space: ColorSpaceResource = linearRgb ? this.linearSpace = this.linearSpace ?? this.document.colors.calibrated([1, 1, 1], SRGB_WHITE, SRGB_MATRIX) : PdfColorSpaces.RGB;
        const colors: Array<ColorStop> = linearRgb ? stops.map((stop: ColorStop): ColorStop => ({ offset: stop.offset, components: stop.components.map((channel: number) =>
            channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4)) })) : stops;
        if (this.projection !== undefined || (cone && spread !== "pad")) {
            return this.projectedGradient(linear, coordinates, local, spread, space, colors, alphas, opacity, stroking);
        }
        const repeat: ShadingRepeat | undefined = spread === "pad" ? undefined : this.repetition(linear, coordinates, local, spread === "reflect");
        if (repeat !== undefined) {
            coordinates = this.repeated(linear, coordinates, repeat);
        }
        this.usePattern(this.pdf.usePattern(this.document.shadings.pattern(this.shade(linear, space, coordinates, colors, repeat), this.geometry.concat(this.ctm, local))), stroking);
        if (alphas.some((stop: ColorStop) => stop.components[0] < 1)) {
            // PDF shadings have no alpha, so the alpha of the stops is a luminosity mask shaded the same way in gray.
            const area: Box = this.localArea() ?? this.area;
            const form: PdfPage = this.document.startForm(area[2], area[3], false);
            form.content.transform(local[0], local[1], local[2], local[3], local[4], local[5]);
            form.content.shade(form.useShading(this.shade(linear, PdfColorSpaces.GRAY, coordinates, alphas, repeat)));
            this.pdf.content.graphicsState(this.pdf.useMask(this.document.finishForm(form, area, SvgGeometry.IDENTITY).object, true));
        }
        this.alpha(opacity, stroking);
        return true;
    }

    private shade(linear: boolean, space: ColorSpaceResource, coordinates: ReadonlyArray<number>, stops: ReadonlyArray<ColorStop>, repeat: ShadingRepeat | undefined): ShadingResource {
        const extend: readonly [boolean, boolean] = repeat === undefined ? [true, true] : [!linear, false];
        return linear ? this.document.shadings.axial(space, [coordinates[0], coordinates[1], coordinates[2], coordinates[3]], stops, extend, repeat)
            : this.document.shadings.radial(space, [coordinates[0], coordinates[1], coordinates[2], coordinates[3], coordinates[4], coordinates[5]], stops, extend, repeat);
    }

    private projectedGradient(linear: boolean, coordinates: ReadonlyArray<number>, local: Matrix, spread: string, space: ColorSpaceResource, colors: ReadonlyArray<ColorStop>,
        alphas: ReadonlyArray<ColorStop>, opacity: number, stroking: boolean): boolean {
        // A calculator function goes back through the projection to the point of the gradient there and leaves its t, and 1
        // where the gradient paints or 0 outside the cone of a radial one (SVG 2 §14.2.3).
        const inverse: Homography | undefined = this.geometry.invertHomography(this.geometry.composeHomography(this.projection ?? SvgGeometry.IDENTITY3,
            this.geometry.planarHomography(local)));
        const area: Box | undefined = this.localArea();
        if (inverse === undefined || area === undefined) {
            return false;
        }
        const n: (value: number) => string = (value: number): string => this.syntax.number(value);
        const least: string = n(1e-9);
        let position: string = "1 index " + n(inverse[6]) + " mul 1 index " + n(inverse[7]) + " mul add " + n(inverse[8]) + " add dup " + least + " lt { pop " + least
            + " } if 2 index " + n(inverse[0]) + " mul 2 index " + n(inverse[1]) + " mul add " + n(inverse[2]) + " add 1 index div 3 index " + n(inverse[3]) + " mul 3 index "
            + n(inverse[4]) + " mul add " + n(inverse[5]) + " add 2 index div 5 2 roll pop pop pop ";
        let cone: boolean = false;
        if (linear) {
            const [x1, y1, x2, y2]: ReadonlyArray<number> = coordinates;
            position += n(y1) + " sub " + n(y2 - y1) + " mul exch " + n(x1) + " sub " + n(x2 - x1) + " mul add " + n((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1)) + " div 1";
        } else {
            // |P - F - t (C - F)| = fr + t (r - fr) for the focal circle F, fr and the end circle C, r: the larger t whose radius
            // is not negative.
            const [fx, fy, fr, cx, cy, r]: ReadonlyArray<number> = coordinates;
            const dr: number = r - fr;
            const a: number = (cx - fx) * (cx - fx) + (cy - fy) * (cy - fy) - dr * dr;
            const valid: string = n(dr) + " mul " + n(fr) + " add 0 ge";
            cone = Math.hypot(cx - fx, cy - fy) + fr > r;
            position += n(fy) + " sub exch " + n(fx) + " sub 2 copy " + n(cx - fx) + " mul exch " + n(cy - fy) + " mul add " + n(fr * dr) + " add 3 1 roll dup mul exch dup mul add "
                + n(fr * fr) + " sub ";
            position += Math.abs(a) < 1e-12 ? "exch 2 mul dup 0 eq { pop " + least + " } if div dup " + valid + " { 1 } { 0 } ifelse"
                : "1 index dup mul exch " + n(a) + " mul sub dup 0 lt { pop pop 0 0 } { sqrt 2 copy add " + n(a) + " div 3 1 roll sub " + n(a) + " div " + (a < 0 ? "exch " : "")
                + "1 index " + valid + " { pop 1 } { dup " + valid + " { exch pop 1 } { pop pop 0 0 } ifelse } ifelse } ifelse";
        }
        const spreading: string = SPREADS[spread] ?? SPREADS["pad"];
        this.usePattern(this.pdf.usePattern(this.document.shadings.pattern(this.calculated(space, position + " pop " + spreading + " " + this.stopCode(colors),
            colors[0].components.length, area), this.ctm)), stroking);
        if (cone || alphas.some((stop: ColorStop) => stop.components[0] < 1)) {
            // PDF shadings have no alpha, so the alpha of the stops, nothing outside the cone, is a luminosity mask shaded in gray.
            const form: PdfPage = this.document.startForm(area[2], area[3], false);
            form.content.shade(form.useShading(this.calculated(PdfColorSpaces.GRAY, position + " exch " + spreading + " " + this.stopCode(alphas) + " mul", 1, area)));
            this.pdf.content.graphicsState(this.pdf.useMask(this.document.finishForm(form, area, SvgGeometry.IDENTITY).object, true));
        }
        this.alpha(opacity, stroking);
        return true;
    }

    private calculated(space: ColorSpaceResource, code: string, outputs: number, area: Box): ShadingResource {
        const domain: string = this.syntax.numbers([area[0], area[0] + area[2], area[1], area[1] + area[3]]);
        const range: string = this.syntax.numbers(Array.from({ length: outputs * 2 }, (item: unknown, index: number) => index % 2));
        const program: number = this.document.file.addStream("/FunctionType 4 /Domain [" + domain + "] /Range [" + range + "]", Buffer.from("{ " + code + " }", "latin1"), true);
        const object: number = this.document.file.add("<< /ShadingType 1 /ColorSpace " + space.value + " /Domain [" + domain + "] /Function " + this.syntax.reference(program) + " >>");
        return { key: "Sh" + object, object };
    }

    private stopCode(stops: ReadonlyArray<ColorStop>): string {
        // SVG 2 §14.2.4: of two stops at one offset, the later takes over there.
        const n: (value: number) => string = (value: number): string => this.syntax.number(value);
        const components: (stop: ColorStop) => string = (stop: ColorStop): string => stop.components.map(n).join(" ");
        let code: string = "pop " + components(stops[stops.length - 1]);
        for (let index: number = stops.length - 2; index >= 0; index--) {
            const from: ColorStop = stops[index];
            const to: ColorStop = stops[index + 1];
            if (to.offset <= from.offset) {
                continue;
            }
            let segment: string = n(from.offset) + " sub " + n(to.offset - from.offset) + " div";
            from.components.forEach((channel: number, channelIndex: number) => {
                segment += " dup " + n(to.components[channelIndex] - channel) + " mul " + n(channel) + " add exch";
            });
            code = "dup " + n(to.offset) + " lt { " + segment + " pop } { " + code + " } ifelse";
        }
        return "dup " + n(stops[0].offset) + " lt { pop " + components(stops[0]) + " } { " + code + " } ifelse";
    }

    private repetition(linear: boolean, coordinates: ReadonlyArray<number>, local: Matrix, reflect: boolean): ShadingRepeat | undefined {
        // SVG 2 §14.2.2.1: reflect and repeat continue the gradient in both directions, as far as the painted area reaches.
        const inverse: Matrix | undefined = this.geometry.invert(this.geometry.concat(this.ctm, local));
        if (inverse === undefined) {
            return undefined;
        }
        const area: Box = this.geometry.transformBox(inverse, this.area);
        const corners: ReadonlyArray<readonly [number, number]> = [[area[0], area[1]], [area[0] + area[2], area[1]], [area[0], area[1] + area[3]], [area[0] + area[2], area[1] + area[3]]];
        if (!linear) {
            const reach: number = Math.max(...corners.map((corner: readonly [number, number]) => Math.hypot(corner[0] - coordinates[0], corner[1] - coordinates[1])));
            const centres: number = Math.hypot(coordinates[3] - coordinates[0], coordinates[4] - coordinates[1]);
            return { from: 0, to: Math.max(1, Math.ceil((reach + centres) / (coordinates[5] - coordinates[2])) + 1), reflect };
        }
        const dx: number = coordinates[2] - coordinates[0];
        const dy: number = coordinates[3] - coordinates[1];
        const ts: Array<number> = corners.map((corner: readonly [number, number]) => ((corner[0] - coordinates[0]) * dx + (corner[1] - coordinates[1]) * dy) / (dx * dx + dy * dy));
        return { from: Math.min(0, Math.floor(Math.min(...ts))), to: Math.max(1, Math.ceil(Math.max(...ts))), reflect };
    }

    private repeated(linear: boolean, coordinates: ReadonlyArray<number>, repeat: ShadingRepeat): Array<number> {
        const at: (start: number, end: number, t: number) => number = (start: number, end: number, t: number): number => start + (end - start) * t;
        return linear ? [at(coordinates[0], coordinates[2], repeat.from), at(coordinates[1], coordinates[3], repeat.from), at(coordinates[0], coordinates[2], repeat.to),
            at(coordinates[1], coordinates[3], repeat.to)]
            : [coordinates[0], coordinates[1], coordinates[2], at(coordinates[0], coordinates[3], repeat.to), at(coordinates[1], coordinates[4], repeat.to), at(coordinates[2], coordinates[5], repeat.to)];
    }

    private stops(chain: ReadonlyArray<readonly [XMLElement, SvgStyles]>, colors: Array<ColorStop>, alphas: Array<ColorStop>): void {
        // SVG 2 §14.2.4: offsets clamped to [0, 1] and never below the one before; the stop's opacity multiplies its colour's.
        const link: readonly [XMLElement, SvgStyles] | undefined = chain.find((candidate: readonly [XMLElement, SvgStyles]) =>
            candidate[0].getChildren().some((child: XMLElement) => candidate[1].isSvg(child, "stop")));
        let previous: number = 0;
        for (const stop of link === undefined ? [] : link[0].getChildren().filter((child: XMLElement) => link[1].isSvg(child, "stop"))) {
            const style: ComputedStyle = link?.[1].placed(stop)[1] as ComputedStyle;
            const text: string = (link?.[1].attribute(stop, "offset") ?? "0").trim();
            const parsed: number = text.endsWith("%") ? Number(text.substring(0, text.length - 1)) / 100 : Number(text);
            const offset: number = Math.max(previous, Math.min(1, Math.max(0, Number.isFinite(parsed) ? parsed : 0)));
            previous = offset;
            const rgba: readonly [number, number, number, number] = this.colors.rgba(style.values["stop-color"], style) ?? [0, 0, 0, 1];
            colors.push({ offset, components: [rgba[0], rgba[1], rgba[2]] });
            alphas.push({ offset, components: [rgba[3] * this.fraction(style.values["stop-opacity"])] });
        }
    }

    private pattern(element: XMLElement, styles: SvgStyles, opacity: number, stroking: boolean, box: Box | undefined, region: Box | undefined): boolean {
        // SVG 2 §14.3: the tile in the units of patternUnits, its content in those of patternContentUnits or its viewBox,
        // and patternTransform; the percentages of the content refer to the referencing element's viewport.
        const chain: Array<readonly [XMLElement, SvgStyles]> = this.chain(element, styles, ["pattern"]);
        const units: boolean = this.inherited(chain, "patternUnits")?.[0] !== "userSpaceOnUse";
        const contentUnits: boolean = this.inherited(chain, "patternContentUnits")?.[0] === "objectBoundingBox";
        if ((units || contentUnits) && (box === undefined || box[2] === 0 || box[3] === 0)) {
            return false;
        }
        const read: (attribute: string, basis: number) => number = (attribute: string, basis: number): number =>
            this.unitLength(this.inherited(chain, attribute), "0", units, units ? 1 : basis);
        let tile: Box = [read("x", this.width), read("y", this.height), read("width", this.width), read("height", this.height)];
        if (units && box !== undefined) {
            tile = [box[0] + tile[0] * box[2], box[1] + tile[1] * box[3], tile[2] * box[2], tile[3] * box[3]];
        }
        const viewBox: Box | undefined = this.geometry.viewBox(this.inherited(chain, "viewBox")?.[0]);
        if (tile[2] <= 0 || tile[3] <= 0 || (viewBox !== undefined && (viewBox[2] === 0 || viewBox[3] === 0))) {
            return false;
        }
        let content: Matrix = SvgGeometry.IDENTITY;
        if (viewBox !== undefined) {
            content = this.geometry.fit(viewBox, this.inherited(chain, "preserveAspectRatio")?.[0], 0, 0, tile[2], tile[3]);
        } else if (contentUnits && box !== undefined) {
            content = [box[2], 0, 0, box[3], 0, 0];
        }
        const transformed: readonly [string, XMLElement, SvgStyles] | undefined = this.inherited(chain, "patternTransform");
        const place: readonly [SvgNode, ComputedStyle] = (transformed?.[2] ?? styles).placed(transformed?.[1] ?? element);
        const placement: Matrix = this.geometry.concat(this.geometry.concat(this.ctm, this.transform(place[0], place[1])), this.geometry.translation(tile[0], tile[1]));
        // §14.1.1: the content is that of the first in the chain with "child elements other than descriptive elements".
        const source: readonly [XMLElement, SvgStyles] | undefined = chain.find((link: readonly [XMLElement, SvgStyles]) =>
            link[0].getChildren().some((child: XMLElement) => link[1].isSvg(child) && !DESCRIPTIVE.has(link[1].localName(child))));
        if (this.projection !== undefined) {
            const user: Matrix = this.geometry.concat(this.transform(place[0], place[1]), this.geometry.translation(tile[0], tile[1]));
            this.tiling = (): void => this.tiles(user, tile, content, source, opacity, region);
            return true;
        }
        const form: PdfPage = this.document.startForm(tile[2], tile[3], false);
        if (source !== undefined) {
            const [sourceNode, sourceStyle]: readonly [SvgNode, ComputedStyle] = source[1].placed(source[0]);
            this.drawIn(form, SvgGeometry.IDENTITY, [0, 0, tile[2], tile[3]], () => this.transformed(content, () =>
                this.inDocument(source[1], this.width, this.height, undefined, undefined, () => this.guarded(source[0], () =>
                    this.quietly(() => this.children(sourceNode, sourceStyle, false))))),
            this.geometry.concat(this.base, placement));
        }
        this.usePattern(this.pdf.usePattern(this.document.finishPattern(form, [0, 0, tile[2], tile[3]], placement)), stroking);
        this.alpha(opacity, stroking);
        return true;
    }

    private tiles(placement: Matrix, tile: Box, content: Matrix, source: readonly [XMLElement, SvgStyles] | undefined, opacity: number, region: Box | undefined): void {
        // The opacity of the paint goes to the tiles as one group, since the content of a tile sets its own.
        const inverse: Matrix | undefined = this.geometry.invert(placement);
        if (inverse === undefined || region === undefined || source === undefined) {
            return;
        }
        const reach: Box = this.geometry.transformBox(inverse, region);
        const [sourceNode, sourceStyle]: readonly [SvgNode, ComputedStyle] = source[1].placed(source[0]);
        const group: ImageResource | undefined = this.group(() => {
            for (let row: number = Math.floor(reach[1] / tile[3]); row < Math.ceil((reach[1] + reach[3]) / tile[3]); row++) {
                for (let column: number = Math.floor(reach[0] / tile[2]); column < Math.ceil((reach[0] + reach[2]) / tile[2]); column++) {
                    this.transformed(this.geometry.concat(placement, this.geometry.translation(column * tile[2], row * tile[3])), () => {
                        this.pdf.content.save();
                        if (this.clipTo(this.geometry.rectangle(0, 0, tile[2], tile[3], 0, 0))) {
                            this.transformed(content, () => this.inDocument(source[1], this.width, this.height, undefined, undefined,
                                () => this.guarded(source[0], () => this.quietly(() => this.children(sourceNode, sourceStyle, false)))));
                        }
                        this.pdf.content.restore();
                    });
                }
            }
        });
        if (group !== undefined) {
            this.pdf.content.graphicsState(this.pdf.useState(opacity, opacity, "Normal"));
            this.pdf.content.paintXObject(this.pdf.useImage(group));
        }
    }

    private markers(path: SvgPath, node: SvgNode, style: ComputedStyle): void {
        let box: Box | undefined;
        this.markerTargets(path, style, (target: readonly [XMLElement, SvgStyles], vertex: readonly [number, number, number], start: boolean) => {
            box = box ?? this.bbox(node, style);
            this.marker(target[0], target[1], vertex, start, style, box);
        });
    }

    private markerBox(path: SvgPath, style: ComputedStyle, kind: string): Box | undefined {
        // SVG 2 §8.10: the decorated bounding box counts the content of each marker drawn on the element.
        let box: Box | undefined;
        this.markerTargets(path, style, (target: readonly [XMLElement, SvgStyles], vertex: readonly [number, number, number], start: boolean) => {
            const placement: readonly [Matrix, Matrix, number, number] | undefined = this.markerPlacement(target[0], target[1], vertex, start, style);
            if (placement === undefined || this.active.has(target[0])) {
                return;
            }
            const [markerNode, markerStyle]: readonly [SvgNode, ComputedStyle] = target[1].placed(target[0]);
            let content: Box | undefined;
            this.inDocument(target[1], this.width, this.height, style, undefined, () => this.guarded(target[0], () => {
                content = this.childrenBox(markerNode, markerStyle, kind);
            }));
            box = this.geometry.union(box, content === undefined ? undefined : this.geometry.transformBox(this.geometry.concat(placement[0], placement[1]), content));
        });
        return box;
    }

    private markerTargets(path: SvgPath, style: ComputedStyle, visit: (target: readonly [XMLElement, SvgStyles], vertex: readonly [number, number, number], start: boolean) => void): void {
        // SVG 2 §13.7.2: marker-start on the first vertex, marker-end on the last and marker-mid on the others; a path of one
        // vertex has both its start and its end there.
        const vertices: Array<readonly [number, number, number]> = this.geometry.vertices(path);
        vertices.forEach((vertex: readonly [number, number, number], index: number) => {
            const properties: Array<string> = [];
            if (index === 0) {
                properties.push("marker-start");
            }
            if (index > 0 && index < vertices.length - 1) {
                properties.push("marker-mid");
            }
            if (index === vertices.length - 1) {
                properties.push("marker-end");
            }
            for (const property of properties) {
                const value: CssValue | undefined = style.values[property];
                const target: readonly [XMLElement, SvgStyles] | undefined = value !== undefined && value.kind === "url" ? this.lookup(value.href) : undefined;
                if (target !== undefined && target[1].isSvg(target[0], "marker")) {
                    visit(target, vertex, property === "marker-start");
                }
            }
        });
    }

    private marker(element: XMLElement, styles: SvgStyles, vertex: readonly [number, number, number], start: boolean, context: ComputedStyle, box: Box | undefined): void {
        // SVG 2 §13.7.4: the marker clips to its viewport unless overflow lets it show.
        const placement: readonly [Matrix, Matrix, number, number] | undefined = this.markerPlacement(element, styles, vertex, start, context);
        if (placement === undefined) {
            return;
        }
        const [matrix, fit, width, height]: readonly [Matrix, Matrix, number, number] = placement;
        const [markerNode, markerStyle]: readonly [SvgNode, ComputedStyle] = styles.placed(element);
        this.pdf.content.save();
        this.transformed(matrix, () => {
            if (!this.clips(markerStyle) || this.clipTo(this.geometry.rectangle(0, 0, width, height, 0, 0))) {
                this.transformed(fit, () => this.inDocument(styles, this.width, this.height, context, box, () => this.guarded(element, () => this.quietly(() => this.children(markerNode, markerStyle, false)))));
            }
        });
        this.pdf.content.restore();
    }

    private markerPlacement(element: XMLElement, styles: SvgStyles, vertex: readonly [number, number, number], start: boolean, context: ComputedStyle): readonly [Matrix, Matrix, number, number] | undefined {
        // SVG 2 §13.7.4: the marker's user space is at the vertex, turned by orient, scaled by markerUnits and fitted with
        // its viewBox so that refX and refY fall on the vertex.
        const markerStyle: ComputedStyle = styles.placed(element)[1];
        const width: number = styles.length(styles.attribute(element, "markerWidth") ?? "3", markerStyle, this.width) ?? 3;
        const height: number = styles.length(styles.attribute(element, "markerHeight") ?? "3", markerStyle, this.height) ?? 3;
        if (width <= 0 || height <= 0) {
            return undefined;
        }
        const viewBox: Box | undefined = this.geometry.viewBox(styles.attribute(element, "viewBox"));
        // §8.6: "A value of zero for width or height disables rendering of the element".
        if (viewBox !== undefined && (viewBox[2] === 0 || viewBox[3] === 0)) {
            return undefined;
        }
        const fit: Matrix = viewBox === undefined ? SvgGeometry.IDENTITY : this.geometry.fit(viewBox, styles.attribute(element, "preserveAspectRatio"), 0, 0, width, height);
        const saved: SvgStyles = this.styles;
        this.styles = styles;
        const reference: readonly [number, number] = this.geometry.point(fit, this.referencePoint(element, "refX", viewBox?.[2] ?? width, markerStyle) ?? 0,
            this.referencePoint(element, "refY", viewBox?.[3] ?? height, markerStyle) ?? 0);
        this.styles = saved;
        const orient: string = (styles.attribute(element, "orient") ?? "0").trim();
        const follows: boolean = orient === "auto" || orient === "auto-start-reverse";
        const strokeUnits: boolean = styles.attribute(element, "markerUnits") !== "userSpaceOnUse";
        const scale: number = strokeUnits ? this.strokeWidth(context) : 1;
        // §13.7.1: non-scaling-stroke "will result in the markers also being non scaling".
        const stretch: readonly [Matrix, Matrix] | undefined = strokeUnits && this.keyword(context.values["vector-effect"]) === "non-scaling-stroke" ? this.stretch() : undefined;
        const direction: readonly [number, number] = stretch === undefined ? [Math.cos(vertex[2]), Math.sin(vertex[2])]
            : this.geometry.point(stretch[0], Math.cos(vertex[2]), Math.sin(vertex[2]));
        const angle: number = follows ? Math.atan2(direction[1], direction[0]) * 180 / Math.PI + (orient !== "auto" && start ? 180 : 0) : this.angle(orient);
        let matrix: Matrix = this.geometry.translation(vertex[0], vertex[1]);
        matrix = this.geometry.concat(stretch === undefined ? matrix : this.geometry.concat(matrix, stretch[1]), this.geometry.rotation(angle));
        matrix = this.geometry.concat(this.geometry.concat(matrix, [scale, 0, 0, scale, 0, 0]), this.geometry.translation(-reference[0], -reference[1]));
        return [matrix, fit, width, height];
    }

    private stretch(): readonly [Matrix, Matrix] | undefined {
        // The polar decomposition L = Q P: P is the matrix without its turn or flip, which would undo the page's own.
        const [a, b, c, d]: Matrix = this.imageMatrix();
        const xx: number = a * a + b * b;
        const xy: number = a * c + b * d;
        const yy: number = c * c + d * d;
        const s: number = Math.abs(a * d - b * c);
        const t: number = Math.sqrt(xx + yy + 2 * s);
        if (t === 0) {
            return undefined;
        }
        const factor: Matrix = [(xx + s) / t, xy / t, xy / t, (yy + s) / t, 0, 0];
        const inverse: Matrix | undefined = this.geometry.invert(factor);
        return inverse === undefined ? undefined : [factor, inverse];
    }

    private angle(text: string): number {
        const match: RegExpExecArray | null = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(deg|grad|rad|turn)?$/i.exec(text);
        const value: number = match === null ? 0 : Number(match[1]);
        switch ((match?.[2] ?? "deg").toLowerCase()) {
            case "grad":
                return value * 0.9;
            case "rad":
                return value * 180 / Math.PI;
            case "turn":
                return value * 360;
            default:
                return value;
        }
    }

    private image(node: SvgNode, style: ComputedStyle): void {
        // SVG 2 §12.3: the image is fitted into its viewport with preserveAspectRatio, and an auto size is the image's own.
        const href: string | undefined = this.styles.href(node.element);
        if (href === undefined || this.hidden(style) || this.collecting) {
            return;
        }
        const url: string = this.styles.resolve(href);
        const natural: ImageSize | undefined = this.formats.size(url);
        const box: Box = this.rectangle(style);
        const width: number = this.keyword(style.values["width"]) === "auto" ? natural?.width ?? 0 : box[2];
        const height: number = this.keyword(style.values["height"]) === "auto" ? natural?.height ?? 0 : box[3];
        if (width <= 0 || height <= 0) {
            return;
        }
        const known: boolean = natural?.width !== undefined && natural.height !== undefined;
        const drawn: readonly [number, number] = known ? [natural?.width as number, natural?.height as number] : [width, height];
        if (drawn[0] <= 0 || drawn[1] <= 0) {
            return;
        }
        const fit: Matrix = known ? this.geometry.fit([0, 0, drawn[0], drawn[1]], this.styles.attribute(node.element, "preserveAspectRatio"), box[0], box[1], width, height)
            : this.geometry.translation(box[0], box[1]);
        const rendering: string = this.keyword(style.values["image-rendering"]) ?? "auto";
        const shown: readonly [number, number] = [drawn[0] * Math.hypot(fit[0], fit[1]) * this.scale, drawn[1] * Math.hypot(fit[2], fit[3]) * this.scale];
        const overflowing: boolean = this.projection === undefined && this.overflows(url);
        const resource: ImageResource | undefined = this.projection === undefined && !overflowing ? this.formats.image(url, {
            width: drawn[0], height: drawn[1], scale: this.scale * Math.sqrt(Math.abs(fit[0] * fit[3] - fit[1] * fit[2])), rendering,
            multiple: this.formats.multiple(rendering, shown, drawn)
        }) : undefined;
        if (this.projection === undefined && !overflowing && resource === undefined) {
            return;
        }
        this.pdf.content.save();
        if (!this.clips(style) || this.clipTo(this.geometry.rectangle(box[0], box[1], width, height, 0, 0))) {
            if (resource !== undefined) {
                this.pdf.content.transform(fit[0], fit[1], fit[2], fit[3], fit[4], fit[5]);
                // ISO 32000-2 §8.9.4 and §8.10.1: an image and these forms fill the unit square, with y up.
                this.pdf.content.transform(drawn[0], 0, 0, -drawn[1], 0, drawn[1]);
                this.pdf.content.paintXObject(this.pdf.useImage(resource));
                if (resource.links !== undefined && !this.collecting && this.quiet === 0) {
                    // The areas of the image's own links are in its unit square with v going down, over its natural size.
                    for (const [area, name, internal] of resource.links) {
                        this.addArea(this.geometry.transformBox(fit, [area.x * drawn[0], area.y * drawn[1], area.width * drawn[0], area.height * drawn[1]]), name, internal);
                    }
                }
            } else if (overflowing) {
                // §3.10: "the svg element always creates an isolated group".
                const group: ImageResource | undefined = this.group(() => this.transformed(fit, () => {
                    // §13.6: a non-scaling stroke is measured in "the viewport coordinate system of the furthest ancestral SVG viewport".
                    const saved: Matrix = this.base;
                    this.base = this.geometry.invert(this.ctm) ?? SvgGeometry.IDENTITY;
                    try {
                        this.inPlace(url, drawn[0], drawn[1], style);
                    } finally {
                        this.base = saved;
                    }
                }));
                if (group !== undefined) {
                    this.pdf.content.paintXObject(this.pdf.useImage(group));
                }
            } else {
                this.transformed(fit, () => this.inPlace(url, drawn[0], drawn[1], style));
            }
        }
        this.pdf.content.restore();
    }

    private overflows(url: string): boolean {
        // §12.3: "The value on the root element of the referenced SVG determines whether the graphics are clipped to the
        // image-rendering rectangle", and the form of an image always clips to its box.
        const styles: SvgStyles | undefined = this.formats.format(url) === this.images ? this.images.styles(url) : undefined;
        return styles !== undefined && !this.clips(styles.style(styles.rootNode()));
    }

    private inPlace(url: string, width: number, height: number, style: ComputedStyle): void {
        if (this.formats.format(url) !== this.images) {
            this.resampled(url, width, height, style);
            return;
        }
        this.images.inline(url, (styles: SvgStyles) => {
            styles.setViewport(width, height);
            const root: SvgNode = styles.rootNode();
            const rootStyle: ComputedStyle = styles.style(root);
            this.inDocument(styles, width, height, undefined, undefined, () =>
                this.effects(root, rootStyle, SvgGeometry.IDENTITY, () => this.viewport(root, rootStyle, [0, 0, width, height], undefined)));
        });
    }

    private resampled(url: string, width: number, height: number, style: ComputedStyle): void {
        const decoded: readonly [ImageSamples, ColorSpaceResource] | undefined = this.formats.samples(url);
        const area: Box | undefined = this.localArea();
        if (decoded === undefined || area === undefined) {
            return;
        }
        const [image, space]: readonly [ImageSamples, ColorSpaceResource] = decoded;
        const map: Homography = this.geometry.composeHomography(this.projection as Homography,
            this.geometry.planarHomography([width / image.width, 0, 0, height / image.height, 0, 0]));
        const inverse: Homography | undefined = this.geometry.invertHomography(map);
        let bounds: Box | undefined;
        for (const polygon of this.geometry.projected(this.geometry.rectangle(0, 0, image.width, image.height, 0, 0), map, this.tolerance())) {
            for (const point of polygon) {
                bounds = this.geometry.union(bounds, [point[0], point[1], 0, 0]);
            }
        }
        const left: number = Math.max(bounds?.[0] ?? 0, area[0]);
        const top: number = Math.max(bounds?.[1] ?? 0, area[1]);
        const right: number = Math.min(bounds === undefined ? 0 : bounds[0] + bounds[2], area[0] + area[2]);
        const bottom: number = Math.min(bounds === undefined ? 0 : bounds[1] + bounds[3], area[1] + area[3]);
        if (inverse === undefined || right <= left || bottom <= top) {
            return;
        }
        let size: number = FINEST_PIXEL / this.scale;
        let columns: number = Math.ceil((right - left) / size);
        let rows: number = Math.ceil((bottom - top) / size);
        if (columns * rows > LARGEST_IMAGE) {
            size *= Math.sqrt(columns * rows / LARGEST_IMAGE);
            columns = Math.ceil((right - left) / size);
            rows = Math.ceil((bottom - top) / size);
        }
        const rendering: string = this.keyword(style.values["image-rendering"]) ?? "auto";
        const target: ImageSamples = this.resample(image, inverse, [left, top, size], [columns, rows], rendering, [width / image.width, height / image.height]);
        const resource: ImageResource = this.formats.write(target, space, false);
        this.pdf.content.save();
        if (this.clipTo(this.geometry.rectangle(0, 0, width, height, 0, 0))) {
            this.pdf.content.transform(columns * size, 0, 0, -rows * size, left, top + rows * size);
            this.pdf.content.paintXObject(this.pdf.useImage(resource));
        }
        this.pdf.content.restore();
    }

    private resample(image: ImageSamples, inverse: Homography, grid: readonly [number, number, number], extent: readonly [number, number], rendering: string,
        natural: readonly [number, number]): ImageSamples {
        // Each new pixel takes the mean of the source over its footprint, since one sample for each pixel aliases where the
        // projection shrinks the image; CSS Images 3 §5.2: crisp-edges and optimizeSpeed take the nearest source pixel.
        const [left, top, size]: readonly [number, number, number] = grid;
        const [columns, rows]: readonly [number, number] = extent;
        const nearest: boolean = NEAREST_RENDERING.has(rendering);
        const pixelated: boolean = rendering === "pixelated";
        const channels: number = image.channels;
        const bytes: number = image.bits / 8;
        const most: number = image.bits === 16 ? 65535 : 255;
        const pixels: Buffer = Buffer.alloc(columns * rows * channels * bytes);
        const alpha: Buffer = Buffer.alloc(columns * rows * bytes);
        const sums: Float64Array = new Float64Array(channels + 1);
        const [h0, h1, h2, h3, h4, h5, h6, h7, h8]: Homography = inverse;
        for (let row: number = 0; row < rows; row++) {
            const cy: number = top + (row + 0.5) * size;
            for (let column: number = 0; column < columns; column++) {
                const cx: number = left + (column + 0.5) * size;
                const u: number = h0 * cx + h1 * cy + h2;
                const v: number = h3 * cx + h4 * cy + h5;
                const w: number = h6 * cx + h7 * cy + h8;
                const x: number = u / w;
                const y: number = v / w;
                if (!(w > 0) || x < 0 || y < 0 || x >= image.width || y >= image.height) {
                    continue;
                }
                const target: number = row * columns + column;
                sums.fill(0);
                if (nearest) {
                    this.accumulate(image, Math.floor(y) * image.width + Math.floor(x), 1, sums);
                    this.store(sums, 1, pixels, alpha, target, channels, most);
                    continue;
                }
                const square: number = w * w;
                const ax: number = (h0 * w - u * h6) / square * size;
                const ay: number = (h3 * w - v * h6) / square * size;
                const bx: number = (h1 * w - u * h7) / square * size;
                const by: number = (h4 * w - v * h7) / square * size;
                const determinant: number = Math.abs(ax * by - bx * ay);
                let kx: number = 1;
                let ky: number = 1;
                if (pixelated && determinant > 0) {
                    // CSS Images 3 §5.2: the integer multiple of the natural size closest to the target size, along each axis
                    // of the image, from the size of a source pixel on the page here.
                    kx = Math.max(1, Math.round(Math.hypot(by, ay) / determinant * size * this.scale / natural[0]));
                    ky = Math.max(1, Math.round(Math.hypot(bx, ax) / determinant * size * this.scale / natural[1]));
                }
                const across: number = Math.min(MAX_TAPS, Math.max(1, Math.ceil(Math.hypot(ax * kx, ay * ky))));
                const down: number = Math.min(MAX_TAPS, Math.max(1, Math.ceil(Math.hypot(bx * kx, by * ky))));
                for (let step: number = 0; step < across; step++) {
                    const s: number = (step + 0.5) / across - 0.5;
                    for (let line: number = 0; line < down; line++) {
                        const t: number = (line + 0.5) / down - 0.5;
                        this.tap(image, (x + s * ax + t * bx) * kx, (y + s * ay + t * by) * ky, kx, ky, sums);
                    }
                }
                this.store(sums, across * down, pixels, alpha, target, channels, most);
            }
        }
        return { width: columns, height: rows, channels: image.channels, bits: image.bits, pixels, alpha };
    }

    private tap(image: ImageSamples, px: number, py: number, kx: number, ky: number, sums: Float64Array): void {
        const width: number = image.width * kx;
        const height: number = image.height * ky;
        const fx: number = Math.min(Math.max(px - 0.5, 0), width - 1);
        const fy: number = Math.min(Math.max(py - 0.5, 0), height - 1);
        const i0: number = Math.floor(fx);
        const j0: number = Math.floor(fy);
        const tx: number = fx - i0;
        const ty: number = fy - j0;
        const c0: number = Math.floor(i0 / kx);
        const c1: number = Math.floor(Math.min(i0 + 1, width - 1) / kx);
        const r0: number = Math.floor(j0 / ky) * image.width;
        const r1: number = Math.floor(Math.min(j0 + 1, height - 1) / ky) * image.width;
        this.accumulate(image, r0 + c0, (1 - tx) * (1 - ty), sums);
        this.accumulate(image, r0 + c1, tx * (1 - ty), sums);
        this.accumulate(image, r1 + c0, (1 - tx) * ty, sums);
        this.accumulate(image, r1 + c1, tx * ty, sums);
    }

    private accumulate(image: ImageSamples, pixel: number, weight: number, sums: Float64Array): void {
        // Colours weighted by their alpha, so that transparent pixels lend no colour to the edges.
        if (weight <= 0) {
            return;
        }
        const channels: number = image.channels;
        const wide: boolean = image.bits === 16;
        const opacity: number = image.alpha === undefined ? 1 : (wide ? image.alpha.readUInt16BE(pixel * 2) / 65535 : image.alpha[pixel] / 255);
        const share: number = weight * opacity;
        for (let channel: number = 0; channel < channels; channel++) {
            const index: number = pixel * channels + channel;
            sums[channel] += share * (wide ? image.pixels.readUInt16BE(index * 2) : image.pixels[index]);
        }
        sums[channels] += share;
    }

    private store(sums: Float64Array, count: number, pixels: Buffer, alpha: Buffer, target: number, channels: number, most: number): void {
        const covered: number = sums[channels];
        const wide: boolean = most > 255;
        for (let channel: number = 0; channel < channels; channel++) {
            const value: number = covered > 0 ? Math.round(sums[channel] / covered) : 0;
            if (wide) {
                pixels.writeUInt16BE(value, (target * channels + channel) * 2);
            } else {
                pixels[target * channels + channel] = value;
            }
        }
        const opacity: number = Math.round(Math.min(1, covered / count) * most);
        if (wide) {
            alpha.writeUInt16BE(opacity, target * 2);
        } else {
            alpha[target] = opacity;
        }
    }

    private clipMask(value: CssValue | undefined, node: SvgNode, style: ComputedStyle): ImageResource | null | undefined {
        // CSS Masking 1 §5.1 and §6.1: a reference to anything but a clipPath clips nothing; the region is a mask of the
        // clipPath's children painted white, intersected with the clipPath's own clip-path.
        if (value === undefined || this.keyword(value) === "none") {
            return undefined;
        }
        if (value.kind !== "url") {
            return this.shapeMask(value, node, style);
        }
        const target: readonly [XMLElement, SvgStyles] | undefined = this.lookup(value.href);
        if (target === undefined || !target[1].isSvg(target[0], "clipPath") || this.active.has(target[0])) {
            return undefined;
        }
        const [clipNode, clipStyle]: readonly [SvgNode, ComputedStyle] = target[1].placed(target[0]);
        let units: Matrix = SvgGeometry.IDENTITY;
        if (target[1].attribute(target[0], "clipPathUnits") === "objectBoundingBox") {
            const box: Box | undefined = this.bbox(node, style);
            if (box === undefined || box[2] === 0 || box[3] === 0) {
                return null;
            }
            units = [box[2], 0, 0, box[3], box[0], box[1]];
        }
        const area: Box | undefined = this.localArea();
        if (area === undefined) {
            return null;
        }
        let result: ImageResource | null | undefined;
        this.guarded(target[0], () => {
            const nested: ImageResource | null | undefined = this.clipMask(clipStyle.values["clip-path"], node, style);
            if (nested === null) {
                result = null;
                return;
            }
            const form: PdfPage = this.document.startForm(area[2], area[3], false);
            this.drawIn(form, SvgGeometry.IDENTITY, area, () => this.inDocument(target[1], this.width, this.height, undefined, undefined, () => {
                if (nested !== undefined) {
                    this.pdf.content.graphicsState(this.pdf.useMask(nested.object, true));
                }
                this.transformed(this.geometry.concat(units, this.transform(clipNode, clipStyle)), () => this.clipShapes(clipNode, clipStyle));
            }));
            result = this.document.finishForm(form, area, SvgGeometry.IDENTITY);
        });
        return result;
    }

    private shapeMask(value: CssValue, node: SvgNode, style: ComputedStyle): ImageResource | null {
        // CSS Masking 1 §5.1: a basic shape in its reference box, border-box when none is given, or the edges of the box
        // alone; for an SVG element, content-box and padding-box are its fill-box, and border-box and margin-box its stroke-box.
        const items: ReadonlyArray<CssValue> = value.kind === "list" ? value.items : [value];
        const shape: CssValue | undefined = items.find((item: CssValue) => item.kind === "function");
        const name: string = this.keyword(items.find((item: CssValue) => item.kind === "ident")) ?? "border-box";
        const reference: Box | undefined = name === "view-box" ? [0, 0, this.width, this.height]
            : this.bbox(node, style, name === "stroke-box" || name === "border-box" || name === "margin-box" ? "stroke" : "fill");
        const area: Box | undefined = this.localArea();
        if (reference === undefined || area === undefined) {
            return null;
        }
        const outline: readonly [SvgPath, boolean] | undefined = shape === undefined ? [this.geometry.rectangle(reference[0], reference[1], reference[2], reference[3], 0, 0), false]
            : this.geometry.basicShape(shape, reference, this.keyword(style.values["direction"]) === "rtl");
        if (outline === undefined) {
            return null;
        }
        const form: PdfPage = this.document.startForm(area[2], area[3], false);
        this.drawIn(form, SvgGeometry.IDENTITY, area, () => {
            this.pdf.content.fillSpace(this.pdf.useColorSpace(PdfColorSpaces.GRAY));
            this.pdf.content.fillColor([1]);
            if (this.outline(outline[0])) {
                this.pdf.content.fill(outline[1]);
            }
        });
        return this.document.finishForm(form, area, SvgGeometry.IDENTITY);
    }

    private clipShapes(node: SvgNode, style: ComputedStyle): void {
        // CSS Masking 1 §6.1: shapes, text, and uses of shapes and text, each with its clip-rule, transform and clip-path.
        for (const element of node.element.getChildren()) {
            const child: SvgNode = { element, parent: node };
            if (!this.styles.isSvg(element) || !this.passes(element)) {
                continue;
            }
            const childStyle: ComputedStyle = this.styles.style(child, style);
            if (this.keyword(childStyle.values["display"]) === "none" || this.hidden(childStyle)) {
                continue;
            }
            let shape: SvgNode = child;
            let shapeStyle: ComputedStyle = childStyle;
            let styles: SvgStyles = this.styles;
            let after: Matrix = SvgGeometry.IDENTITY;
            if (this.styles.localName(element) === "use") {
                const target: readonly [XMLElement, SvgStyles] | undefined = this.target(element);
                if (target === undefined || !target[1].isSvg(target[0])) {
                    continue;
                }
                after = this.geometry.translation(this.styles.pixels(childStyle.values["x"], this.width), this.styles.pixels(childStyle.values["y"], this.height));
                styles = target[1];
                shape = { element: target[0] };
                shapeStyle = styles.style(shape, childStyle);
            }
            const name: string = styles.localName(shape.element);
            if (!SHAPES.has(name) && name !== "text") {
                continue;
            }
            const clipped: SvgNode = shape;
            const clippedStyle: ComputedStyle = shapeStyle;
            const outer: Matrix4 = this.geometry.multiply4(this.spatial(child, childStyle), this.geometry.lift(after));
            this.pdf.content.save();
            this.within(outer, () => this.inDocument(styles, this.width, this.height, undefined, undefined, () => {
                const inner: Matrix4 = clipped === child ? SvgGeometry.IDENTITY4 : this.spatial(clipped, clippedStyle);
                this.within(inner, () => {
                    const nested: ImageResource | null | undefined = this.clipMask(clippedStyle.values["clip-path"], clipped, clippedStyle);
                    if (nested === null) {
                        return;
                    }
                    const paint: () => void = () => {
                        this.pdf.content.fillSpace(this.pdf.useColorSpace(PdfColorSpaces.GRAY));
                        this.pdf.content.fillColor([1]);
                        if (name === "text") {
                            this.text.paint(clipped, clippedStyle, true);
                            return;
                        }
                        const path: SvgPath | undefined = this.path(clipped, clippedStyle);
                        if (path !== undefined && this.outline(path)) {
                            this.pdf.content.fill(this.keyword(clippedStyle.values["clip-rule"]) === "evenodd");
                        }
                    };
                    const group: ImageResource | undefined = nested === undefined ? undefined : this.group(paint);
                    if (nested === undefined) {
                        paint();
                    } else if (group !== undefined) {
                        this.pdf.content.graphicsState(this.pdf.useMask(nested.object, true));
                        this.pdf.content.paintXObject(this.pdf.useImage(group));
                    }
                });
            }));
            this.pdf.content.restore();
        }
    }

    private mask(node: SvgNode, style: ComputedStyle): readonly [ImageResource, boolean] | null | undefined {
        // CSS Masking 1 §9.1: the mask region in the units of maskUnits and its content in those of maskContentUnits, as a
        // luminance or an alpha mask; §7.1: a reference that is not to a mask element is a layer of transparent black.
        const value: CssValue | undefined = style.values["mask-image"] ?? style.values["mask"];
        const url: CssValue | undefined = value === undefined ? undefined : (value.kind === "list" ? value.items.find((item: CssValue) => item.kind === "url") : value);
        const image: boolean = url !== undefined && url.kind === "url" && !this.styles.resolve(url.href).includes("#");
        if (url === undefined || url.kind !== "url" || image) {
            if (value !== undefined && this.keyword(value) !== "none") {
                throw new Error("The painting of mask images other than mask elements in the SVG image " + this.styles.url + " is not implemented");
            }
            return undefined;
        }
        const target: readonly [XMLElement, SvgStyles] | undefined = this.lookup(url.href);
        if (target === undefined || !target[1].isSvg(target[0], "mask") || this.active.has(target[0])) {
            return null;
        }
        const [element, styles]: readonly [XMLElement, SvgStyles] = target;
        const [maskNode, maskStyle]: readonly [SvgNode, ComputedStyle] = styles.placed(element);
        const units: boolean = styles.attribute(element, "maskUnits") !== "userSpaceOnUse";
        const contentUnits: boolean = styles.attribute(element, "maskContentUnits") === "objectBoundingBox";
        const box: Box | undefined = units || contentUnits ? this.bbox(node, style) : undefined;
        if ((units || contentUnits) && (box === undefined || box[2] === 0 || box[3] === 0)) {
            return null;
        }
        const read: (attribute: string, fallback: string, basis: number) => number = (attribute: string, fallback: string, basis: number): number => {
            const text: string | undefined = styles.attribute(element, attribute);
            return this.unitLength(text === undefined ? undefined : [text, element, styles], fallback, units, units ? 1 : basis);
        };
        let region: Box = [read("x", "-10%", this.width), read("y", "-10%", this.height), read("width", "120%", this.width), read("height", "120%", this.height)];
        if (units && box !== undefined) {
            region = [box[0] + region[0] * box[2], box[1] + region[1] * box[3], region[2] * box[2], region[3] * box[3]];
        }
        const area: Box | undefined = this.localArea();
        if (region[2] <= 0 || region[3] <= 0 || area === undefined) {
            return null;
        }
        const form: PdfPage = this.document.startForm(area[2], area[3], false);
        this.drawIn(form, SvgGeometry.IDENTITY, area, () => {
            if (this.clipTo(this.geometry.rectangle(region[0], region[1], region[2], region[3], 0, 0))) {
                this.transformed(contentUnits && box !== undefined ? [box[2], 0, 0, box[3], box[0], box[1]] : SvgGeometry.IDENTITY, () =>
                    this.inDocument(styles, this.width, this.height, undefined, undefined, () => this.guarded(element, () => this.quietly(() => this.children(maskNode, maskStyle, false)))));
            }
        });
        return [this.document.finishForm(form, area, SvgGeometry.IDENTITY), this.keyword(maskStyle.values["mask-type"]) !== "alpha"];
    }

    private bbox(node: SvgNode, style: ComputedStyle, kind: string = "fill"): Box | undefined {
        // SVG 2 §8.10: the object ("fill"), stroke or decorated bounding box, without children that are not rendered; the
        // "ink" box, what a plane paints, is the decorated one with the ink of glyphs, which can reach out of their cells.
        const styles: SvgStyles = this.styles;
        const name: string = styles.localName(node.element);
        const stroke: boolean = kind !== "fill" && this.keyword(style.values["stroke"]) !== "none";
        if (SHAPES.has(name)) {
            const path: SvgPath | undefined = this.path(node, style);
            if (path === undefined) {
                return undefined;
            }
            const box: Box | undefined = this.geometry.union(this.geometry.bounds(path, SvgGeometry.IDENTITY), stroke ? this.strokeShape(path, style) : undefined);
            return kind === "decorated" || kind === "ink" ? this.geometry.union(box, this.markerBox(path, style, kind)) : box;
        }
        if (name === "image") {
            return this.rectangle(style);
        }
        if (name === "text") {
            const cells: Box | undefined = this.text.bbox(node, style);
            const box: Box | undefined = kind === "ink" ? this.geometry.union(cells, this.text.ink(node, style)) : cells;
            const half: number = stroke ? this.strokeWidth(style) / 2 : 0;
            return box === undefined ? undefined : [box[0] - half, box[1] - half, box[2] + 2 * half, box[3] + 2 * half];
        }
        if (name === "svg") {
            return this.viewportBox(node, style, this.rectangle(style), undefined, kind);
        }
        if (name === "use") {
            const target: readonly [XMLElement, SvgStyles] | undefined = this.target(node.element);
            if (target === undefined || this.active.has(target[0])) {
                return undefined;
            }
            const instance: SvgNode = { element: target[0] };
            const size: readonly [number, number] = [styles.pixels(style.values["width"], this.width), styles.pixels(style.values["height"], this.height)];
            let inner: Box | undefined;
            this.inDocument(target[1], this.width, this.height, this.context, this.contextBox, () => this.guarded(target[0], () => {
                const instanceStyle: ComputedStyle = target[1].style(instance, style);
                const targetName: string = target[1].localName(target[0]);
                if (targetName !== "symbol" && targetName !== "svg") {
                    const own: Box | undefined = this.keyword(instanceStyle.values["display"]) === "none" ? undefined : this.bbox(instance, instanceStyle, kind);
                    inner = own === undefined ? undefined : this.geometry.projectBox(this.geometry.multiply4(this.perspective(instance), this.spatial(instance, instanceStyle)), own);
                    return;
                }
                const [box, reference]: readonly [Box, readonly [number | undefined, number | undefined] | undefined] = this.usedViewport(instance, instanceStyle, style, size);
                const content: Box | undefined = this.viewportBox(instance, instanceStyle, box, reference, kind);
                inner = content === undefined ? undefined : this.geometry.projectBox(this.spatial(instance, instanceStyle), content);
            }));
            const translation: Matrix = this.geometry.translation(styles.pixels(style.values["x"], this.width), styles.pixels(style.values["y"], this.height));
            return inner === undefined ? undefined : this.geometry.transformBox(translation, inner);
        }
        return this.childrenBox(node, style, kind);
    }

    private viewportBox(node: SvgNode, style: ComputedStyle, viewport: Box, reference: readonly [number | undefined, number | undefined] | undefined, kind: string): Box | undefined {
        // The content of a viewport, in the coordinates around it.
        const placement: readonly [Matrix, number, number] | undefined = this.placement(node.element, viewport, reference);
        if (placement === undefined) {
            return undefined;
        }
        let box: Box | undefined;
        this.inDocument(this.styles, placement[1], placement[2], this.context, this.contextBox, () => {
            box = this.childrenBox(node, style, kind);
        });
        return box === undefined ? undefined : this.geometry.transformBox(placement[0], box);
    }

    private childrenBox(node: SvgNode, style: ComputedStyle, kind: string): Box | undefined {
        const styles: SvgStyles = this.styles;
        let box: Box | undefined;
        for (const element of node.element.getChildren()) {
            if (styles.isSvg(element) && !NEVER_RENDERED.has(styles.localName(element)) && this.passes(element)) {
                const child: SvgNode = { element, parent: node };
                box = this.geometry.union(box, this.childBox(child, styles.style(child, style), kind));
            }
        }
        return box;
    }

    private childBox(child: SvgNode, style: ComputedStyle, kind: string): Box | undefined {
        if (this.keyword(style.values["display"]) === "none" || this.active.has(child.element)) {
            return undefined;
        }
        let box: Box | undefined;
        this.guarded(child.element, () => {
            const inner: Box | undefined = this.bbox(child, style, kind);
            box = inner === undefined ? undefined : this.geometry.projectBox(this.geometry.multiply4(this.perspective(child), this.spatial(child, style)), inner);
        });
        return box;
    }

    private strokeShape(path: SvgPath, style: ComputedStyle): Box | undefined {
        // SVG 2 §13.6: a non-scaling stroke has its width in the coordinates of the image, so its shape is found there; §8.10:
        // the stroke shape counts "with the assumption that the element has no dash pattern".
        const stroke: StrokeStyle = this.outlineStyle(style, this.strokeWidth(style), undefined);
        if (this.keyword(style.values["vector-effect"]) !== "non-scaling-stroke") {
            return this.geometry.bounds(this.geometry.strokeOutline(path, stroke, this.tolerance(), SvgGeometry.IDENTITY3), SvgGeometry.IDENTITY);
        }
        const inverse: Matrix | undefined = this.geometry.invert(this.imageMatrix());
        const shape: SvgPath = this.geometry.strokeOutline(this.geometry.transformPath(path, this.imageMatrix()), stroke, this.imageTolerance(), SvgGeometry.IDENTITY3);
        const bounds: Box | undefined = this.geometry.bounds(shape, SvgGeometry.IDENTITY);
        return inverse === undefined || bounds === undefined ? undefined : this.geometry.transformBox(inverse, bounds);
    }

    private imageTolerance(): number {
        // The flatness in the coordinates of the image, which the current matrix maps the user space to.
        const matrix: Matrix = this.imageMatrix();
        return FLATNESS * Math.sqrt(Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2])) / this.scale;
    }

    private keyword(value: CssValue | undefined): string | undefined {
        return value !== undefined && value.kind === "ident" ? value.lower : undefined;
    }

    fraction(value: CssValue | undefined): number {
        // CSS Color 4 §3.2: an opacity is a number or a percentage, clamped to [0, 1].
        if (value === undefined) {
            return 1;
        }
        return Math.min(1, Math.max(0, value.kind === "percentage" ? value.value / 100 : (value.kind === "number" ? value.value : 1)));
    }
}
