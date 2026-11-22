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

import type { CssValue } from "../css/values/CssValue.js";
import type { Box, Homography, Matrix } from "../geometry/PathGeometry.js";
import { PathGeometry } from "../geometry/PathGeometry.js";
import type { Transform } from "../layout/BoxSizes.js";
import { BoxSizes } from "../layout/BoxSizes.js";
import { BoxTransforms } from "../layout/BoxTransforms.js";
import type { AnchorLink, BoxFragment, CollapsedBorders, EdgeSource, LineFragment, ObjectArea, Sides, TextPiece, WholeBox } from "../layout/Fragment.js";
import type { MarginForms, PageLayout } from "../pages/PageDriver.js";
import type { PageSetup } from "../PdfGenerator.js";
import type { SourceElement } from "../parse/SourceElement.js";
import type { ElementBox } from "../pdf/BoxTree.js";
import type { ComputedStyle } from "../pdf/ComputedStyle.js";
import { DisplayTypes } from "../pdf/DisplayTypes.js";
import type { PageCanvas, Rectangle } from "../pdf/PageCanvas.js";
import { SvgGeometry } from "../svg/SvgGeometry.js";
import type { Matrix4, SvgPath } from "../svg/SvgGeometry.js";
import type { PdfDocument } from "../writer/PdfDocument.js";
import type { ImageResource, PageRectangle, PdfPage } from "../writer/PdfPage.js";
import type { BackgroundPlace } from "./BackgroundPainter.js";
import { BackgroundPainter } from "./BackgroundPainter.js";
import type { CornerRadii, PhysicalSides } from "./BorderPainter.js";
import { BorderPainter } from "./BorderPainter.js";
import type { ColorOutput } from "./ColorOutput.js";
import type { ImageMarks } from "./ImagePainter.js";
import { ImagePainter } from "./ImagePainter.js";
import { TextPainter } from "./TextPainter.js";

interface Clip {
    rectangle: Rectangle;
    radii: CornerRadii;
}

export interface ClipArea {
    rectangle: Rectangle;
    radii: CornerRadii;
    across: boolean;
    down: boolean;
}

export interface BoxContent {
    paint(fragment: BoxFragment, inner: Transform, pdf: PdfPage): void;
    ink(fragment: BoxFragment, inner: Transform): Box | undefined;
    shapes(fragment: BoxFragment, inner: Transform, pdf: PdfPage): void;
}

interface Collected {
    links: Array<readonly [PageRectangle, string, boolean]>;
    destinations: Array<readonly [string, number, number]>;
}

interface WholeGeometry {
    area: Rectangle;
    margin: PhysicalSides;
    border: PhysicalSides;
    padding: PhysicalSides;
    sizing: Rectangle;
}

interface Placed {
    fragment: BoxFragment;
    transform: Transform;
    frame: number;
    view: Matrix4 | undefined;
}

interface Held {
    clip: Clip;
    positioned: boolean;
    fixed: boolean;
}

interface Grouping {
    alpha: number;
    blend: string;
}

interface Layer {
    fragment: BoxFragment;
    transform: Transform;
    frame: number;
    z: number;
    context: boolean;
    clips: ReadonlyArray<Clip>;
    matrix?: Matrix4;
    host?: ElementBox;
    held?: ReadonlyArray<Held>;
    line?: InlineSlice;
}

interface InlineSlice {
    line: LineFragment;
    transform: Transform;
    decorators: ReadonlyArray<ComputedStyle>;
}

interface Space {
    popped: Set<BoxFragment>;
    extending: Set<BoxFragment>;
}

interface Plane {
    entry: Layer;
    matrix: Matrix4;
}

const POINTS_PER_PIXEL: number = 0.75;
const PHYSICAL: number = 0;
const SIDE_NAMES: ReadonlyArray<string> = ["block-start", "inline-end", "block-end", "inline-start"];
const PHYSICAL_NAMES: ReadonlyArray<string> = ["top", "right", "bottom", "left"];
const RULE_WIDTHS: ReadonlyMap<string, number> = new Map<string, number>([["thin", 1], ["medium", 3], ["thick", 5]]);
const HIDDEN: ReadonlySet<string> = new Set<string>(["hidden", "collapse", "force-hidden"]);
const UNPAINTED: ReadonlyArray<string> = ["filter", "backdrop-filter", "mask-image", "mask-border-source", "box-shadow-offset", "outline-style", "border-image-source"];
const REGION_FLATNESS: number = 0.05;
const PIECE_TOLERANCE: number = 0.001;
const CELL_FLOOR: number = 0.25;
const CELL_ERROR: number = 0.05;
const CELL_OVERLAP: number = 0.5;
const RADII: ReadonlyArray<string> = ["border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius"];
const NO_SIDES: PhysicalSides = [0, 0, 0, 0];
const NO_RADII: CornerRadii = [0, 0, 0, 0, 0, 0, 0, 0];
const CLIPPING: ReadonlySet<string> = new Set<string>(["hidden", "clip", "scroll", "auto"]);
const OPAQUE: CssValue = { kind: "color", space: "srgb", components: [0, 0, 0], alpha: 1, legacy: false };
const OPAQUE_SIDES: ReadonlyArray<CssValue> = [OPAQUE, OPAQUE, OPAQUE, OPAQUE];

export class PagePainter {

    private readonly setup: PageSetup;
    private readonly document: PdfDocument;
    private readonly sizes: BoxSizes = new BoxSizes((): number | undefined => undefined);
    private readonly displays: DisplayTypes = new DisplayTypes();
    private readonly transforms: BoxTransforms = new BoxTransforms(this.sizes);
    private readonly pseudoKeys: WeakMap<SourceElement, Map<string, ElementBox>> = new WeakMap<SourceElement, Map<string, ElementBox>>();
    private readonly text: TextPainter;
    private readonly backgrounds: BackgroundPainter;
    private readonly borders: BorderPainter;
    private readonly images: ImagePainter;
    private annotated?: PdfPage;
    private readonly geometry: SvgGeometry = new SvgGeometry();
    private reach: Rectangle = { x: 0, y: 0, width: 0, height: 0 };
    private lens?: Homography;
    private space?: Space;
    private footprint?: Box;
    private moved: boolean = false;
    private base: Matrix = PathGeometry.IDENTITY;
    private page: Rectangle = { x: 0, y: 0, width: 0, height: 0 };
    private drawing?: BoxContent;
    private collected?: Collected;

    constructor(setup: PageSetup, document: PdfDocument) {
        this.setup = setup;
        this.document = document;
        const colors: ColorOutput = setup.colors;
        this.text = new TextPainter(document, colors, this.sizes, setup.metrics, setup.viewport, setup.palettes, setup.images);
        this.borders = new BorderPainter(colors);
        this.images = new ImagePainter(setup.images, this.sizes, document, colors);
        this.backgrounds = new BackgroundPainter(colors, this.borders, this.images, document);
    }

    paint(page: PageLayout, pdf: PdfPage): void {
        // The layout is in CSS pixels, and the page in points.
        const canvas: PageCanvas = page.canvas;
        this.pageSupported(canvas);
        this.annotated = pdf;
        this.reach = { x: 0, y: 0, width: canvas.sheet.width, height: canvas.sheet.height };
        delete this.lens;
        this.moved = false;
        pdf.content.transform(POINTS_PER_PIXEL, 0, 0, POINTS_PER_PIXEL, 0, 0);
        // The default space of the page has its origin at the bottom left in points; a pattern is placed in it.
        this.base = [POINTS_PER_PIXEL, 0, 0, -POINTS_PER_PIXEL, 0, pdf.height];
        const sheet: Rectangle = { x: 0, y: 0, width: canvas.sheet.width, height: canvas.sheet.height };
        this.page = sheet;
        const roots: Array<Layer> = [];
        for (const fragment of [page.content, page.footnotes, ...(page.floats ?? []), page.fixed]) {
            if (fragment !== undefined) {
                roots.push(this.pageLayer(fragment, page, canvas));
            }
        }
        this.anchorVisibility(roots);
        this.anchorVisibility(this.marginLayers(page.margins ?? []));
        const pageBorders: PhysicalSides = [canvas.borders.top, canvas.borders.right, canvas.borders.bottom, canvas.borders.left];
        const pagePadding: PhysicalSides = [canvas.padding.top, canvas.padding.right, canvas.padding.bottom, canvas.padding.left];
        // "its background painting area is the bleed area, which covers the entire page box, including its margins
        // (regardless of background-clip)"; "Page backgrounds are anchored within the page box's padding area by default".
        this.backgrounds.paint(sheet, NO_SIDES, NO_SIDES, canvas.style, pdf, "border-box", NO_RADII,
            { base: this.base, page: sheet, whole: [canvas.borderBox, pageBorders, pagePadding] });
        // "the page-margin boxes never interleave with parts of the document content", which is one stacking context of
        // z-index 0 above the page background; each margin box makes a stacking context and takes z-index as if positioned.
        const margins: Array<Layer> = this.marginLayers(page.margins ?? []);
        const forms: MarginForms | undefined = page.forms;
        if (forms?.below !== undefined) {
            pdf.content.paintXObject(pdf.useImage(forms.below));
        }
        for (const layer of margins.filter((candidate: Layer) => candidate.z < 0).sort(this.order)) {
            this.context(layer, pdf, false);
        }
        // CSS Backgrounds 4 §4.1: "The document canvas background is drawn as the page box's background", and the root does not paint it
        // again. CSS Transforms 1 §3: a root transform "applies to the entire canvas, including any background", so it covers the page.
        const canvasBackground: (target: PdfPage) => void = (target: PdfPage): void => {
            // Backgrounds 4 §2.8: "the background-clip property has no effect when specified on" the root element.
            const whole: readonly [Rectangle, PhysicalSides, PhysicalSides] = this.rootArea(page);
            this.backgrounds.paint(this.moved ? this.reach : canvas.borderBox, pageBorders, pagePadding, this.setup.root, target, "border-box", NO_RADII,
                this.moved ? { base: this.base, whole } : { base: this.base, page: sheet, whole });
        };
        const rootLayer: Layer | undefined = page.content === undefined ? undefined : this.pageLayer(page.content, page, canvas);
        if (rootLayer?.matrix === undefined) {
            canvasBackground(pdf);
        } else {
            this.transformed(rootLayer, rootLayer.matrix, pdf, canvasBackground);
        }
        this.borders.paint(canvas.borderBox, pageBorders, PHYSICAL_NAMES.map((side: string) => this.keyword(canvas.style.values["border-" + side + "-style"])),
            PHYSICAL_NAMES.map((side: string) => canvas.style.values["border-" + side + "-color"]), canvas.style, pdf);
        // GCPM 3 §2.4.1: the footnote area is placed in the page area, in the same coordinates as the content; CSS Page Floats 3 §3.1:
        // the page floats too, which take their parts of the page area.
        for (const fragment of [page.content, page.footnotes, ...(page.floats ?? []), page.fixed]) {
            if (fragment === undefined) {
                continue;
            }
            this.context(this.pageLayer(fragment, page, canvas), pdf, fragment === page.content);
        }
        for (const layer of margins.filter((candidate: Layer) => candidate.z >= 0).sort(this.order)) {
            this.context(layer, pdf, false);
        }
        if (forms !== undefined) {
            pdf.content.paintXObject(pdf.useImage(forms.above));
        }
    }

    private pageLayer(fragment: BoxFragment, page: PageLayout, canvas: PageCanvas): Layer {
        const area: Rectangle = canvas.pageArea;
        const frame: number = this.sizes.frame((page.content ?? fragment).box.style);
        const transform: Transform = this.sizes.compose([1, 0, 0, 1, area.x, area.y], this.sizes.between(frame, PHYSICAL, area.width, area.height));
        return this.layer(fragment, transform, frame, 0, true, [], undefined, undefined);
    }

    private rootArea(page: PageLayout): readonly [Rectangle, PhysicalSides, PhysicalSides] {
        // The box of the root element on the page, or the page area when the page holds none of it.
        const area: Rectangle = page.canvas.pageArea;
        const fragment: BoxFragment | undefined = page.content;
        if (fragment === undefined) {
            return [area, NO_SIDES, NO_SIDES];
        }
        const transform: Transform = this.sizes.compose([1, 0, 0, 1, area.x, area.y], this.sizes.between(this.sizes.frame(fragment.box.style), PHYSICAL, area.width, area.height));
        const box: readonly [number, number, number, number] = this.sizes.mapped(transform, fragment.inline, fragment.block, fragment.inlineSize, fragment.blockSize);
        const [borders, padding]: readonly [PhysicalSides, PhysicalSides] = this.edges(fragment);
        return [{ x: box[0], y: box[1], width: box[2], height: box[3] }, borders, padding];
    }

    margins(fragments: ReadonlyArray<BoxFragment>, forms: MarginForms, document: PdfDocument, page: PdfPage): void {
        // The margin boxes are painted in forms whose own space is the page in pixels.
        this.base = PathGeometry.IDENTITY;
        this.page = { x: 0, y: 0, width: forms.above.width, height: forms.above.height };
        this.annotated = page;
        this.reach = { x: 0, y: 0, width: forms.above.width, height: forms.above.height };
        delete this.lens;
        this.moved = false;
        const layers: Array<Layer> = this.marginLayers(fragments);
        this.anchorVisibility(layers);
        if (forms.below !== undefined) {
            this.form(layers.filter((candidate: Layer) => candidate.z < 0), forms.below, document);
        }
        this.form(layers.filter((candidate: Layer) => forms.below === undefined || candidate.z >= 0), forms.above, document);
    }

    formula(fragment: BoxFragment, transform: Transform, pdf: PdfPage, drawing: BoxContent, area: Box, page: Rectangle | undefined): ImageMarks {
        // MathML Core §2.2.2: the boxes inside a formula are painted in the order of CSS 2 Appendix E with their effects, into the formula's form,
        // whose y goes down from its top; the math element's own box, with its background and effects, is the replaced box that shows the form.
        const saved: readonly [PdfPage | undefined, Rectangle, Homography | undefined, boolean, Matrix, Rectangle, BoxContent | undefined, Collected | undefined] =
            [this.annotated, this.reach, this.lens, this.moved, this.base, this.page, this.drawing, this.collected];
        const marks: Collected = { links: [], destinations: [] };
        delete this.annotated;
        delete this.lens;
        this.reach = { x: area[0], y: area[1], width: area[2], height: area[3] };
        // CSS Backgrounds 3 §2.5: a fixed background is placed by the page box, given in the form's space; without one the formula is in a
        // transform, where CSS Transforms 1 §3 treats fixed as scroll.
        this.moved = page === undefined;
        this.page = page ?? this.reach;
        this.base = [1, 0, 0, -1, 0, pdf.height];
        this.drawing = drawing;
        this.collected = marks;
        try {
            const layer: Layer = this.layer(fragment, transform, this.sizes.frame(fragment.box.style), 0, true, [], undefined, undefined);
            this.anchorVisibility([layer]);
            this.stack(layer, pdf, false, false, false);
        } finally {
            if (saved[0] === undefined) {
                delete this.annotated;
            } else {
                this.annotated = saved[0];
            }
            this.reach = saved[1];
            if (saved[2] === undefined) {
                delete this.lens;
            } else {
                this.lens = saved[2];
            }
            this.moved = saved[3];
            this.base = saved[4];
            this.page = saved[5];
            this.restoreContent(saved[6], saved[7]);
        }
        return marks;
    }

    extent(fragment: BoxFragment, transform: Transform, drawing: BoxContent): Box | undefined {
        // What the boxes inside a formula paint, without the math element's own box, for the bounds of the formula's form.
        const saved: readonly [BoxContent | undefined, Collected | undefined] = [this.drawing, this.collected];
        this.drawing = drawing;
        try {
            return this.contentInk(fragment, transform, this.sizes.frame(fragment.box.style), undefined, this.decorated([], fragment.box.style));
        } finally {
            this.restoreContent(saved[0], saved[1]);
        }
    }

    private restoreContent(drawing: BoxContent | undefined, collected: Collected | undefined): void {
        if (drawing === undefined) {
            delete this.drawing;
        } else {
            this.drawing = drawing;
        }
        if (collected === undefined) {
            delete this.collected;
        } else {
            this.collected = collected;
        }
    }

    private form(layers: Array<Layer>, reserved: ImageResource, document: PdfDocument): void {
        const form: PdfPage = document.startForm(reserved.width, reserved.height, false, reserved);
        for (const layer of layers.sort(this.order)) {
            this.context(layer, form, false);
        }
        document.finishForm(form, [0, 0, reserved.width, reserved.height], PathGeometry.IDENTITY);
    }

    private marginLayers(fragments: ReadonlyArray<BoxFragment>): Array<Layer> {
        return fragments.map((fragment: BoxFragment): Layer => this.layer(fragment, BoxSizes.IDENTITY, PHYSICAL, this.zIndex(fragment.box) ?? 0, true, [], undefined, undefined));
    }

    private layer(fragment: BoxFragment, transform: Transform, frame: number, z: number, context: boolean, clips: ReadonlyArray<Clip>, view: Matrix4 | undefined, host: ElementBox | undefined): Layer {
        const matrix: Matrix4 | undefined = this.matrixOf(fragment, transform, view);
        const layer: Layer = matrix === undefined ? { fragment, transform, frame, z, context, clips } : { fragment, transform, frame, z, context, clips, matrix };
        if (host !== undefined) {
            layer.host = host;
        }
        return layer;
    }

    private matrixOf(fragment: BoxFragment, transform: Transform, view: Matrix4 | undefined): Matrix4 | undefined {
        return this.transforms.matrixOf(fragment, transform, view);
    }

    private eye(fragment: BoxFragment, transform: Transform): Matrix4 | undefined {
        return this.transforms.eye(fragment, transform);
    }

    private reference(fragment: BoxFragment, transform: Transform): Box {
        return this.transforms.reference(fragment, transform);
    }

    private clipReference(fragment: BoxFragment, transform: Transform): Box {
        // CSS Fragmentation 4 §5.4: the reference box of a sliced box is taken from the whole box, as the shapes of its clip-path are.
        const whole: WholeGeometry | undefined = this.wholeGeometry(fragment, transform);
        if (whole === undefined) {
            return this.reference(fragment, transform);
        }
        const area: Rectangle = whole.area;
        const keyword: string = this.keyword(fragment.box.style.values["transform-box"]);
        if (keyword !== "content-box" && keyword !== "fill-box") {
            return [area.x, area.y, area.width, area.height];
        }
        const top: number = whole.border[0] + whole.padding[0];
        const right: number = whole.border[1] + whole.padding[1];
        const bottom: number = whole.border[2] + whole.padding[2];
        const left: number = whole.border[3] + whole.padding[3];
        return [area.x + left, area.y + top, Math.max(0, area.width - left - right), Math.max(0, area.height - top - bottom)];
    }

    private order(first: Layer, second: Layer): number {
        return first.z - second.z;
    }

    private pageSupported(canvas: PageCanvas): void {
        if (canvas.bleed > 0 || canvas.cropMarks || canvas.crossMarks) {
            throw new Error("The painting of bleed and marks is not implemented");
        }
    }

    private context(entry: Layer, pdf: PdfPage, root: boolean): void {
        // A box that has its own plane in a 3D rendering context is drawn with the planes, not with its parent's.
        const space: Space | undefined = this.space;
        if (space !== undefined && space.popped.has(entry.fragment)) {
            return;
        }
        // The clips of the boxes that hold a layer apply outside of its own transform. A layer without one applies them to its own box and
        // content, and the layers inside it take those that hold their containing blocks (CSS Overflow 3 §3), a fixed box often none.
        if (entry.matrix === undefined && !(this.preserves(entry) && (space === undefined || !space.extending.has(entry.fragment)))) {
            this.grouped(entry, pdf, (target: PdfPage): void => this.clipped(entry, target, (inner: PdfPage): void => this.stack(entry, inner, root, true)));
            return;
        }
        this.enter(entry.clips, pdf);
        if (this.preserves(entry) && (space === undefined || !space.extending.has(entry.fragment))) {
            this.establish(entry, pdf, root);
        } else {
            this.transformed(entry, entry.matrix as Matrix4, pdf, (target: PdfPage): void => this.clipped(entry, target, (inner: PdfPage): void => this.stack(entry, inner, root)));
        }
        this.leave(entry.clips, pdf);
    }

    private preserves(entry: Layer): boolean {
        // CSS Transforms 2 §7: transform-style preserve-3d is used as flat when a grouping property is present.
        const box: ElementBox = entry.fragment.box;
        const values: Readonly<Record<string, CssValue>> = box.style.values;
        if (this.keyword(values["transform-style"]) !== "preserve-3d" || !this.displays.isTransformable(box.display, box.replaced) || this.grouping(box.style) !== undefined) {
            return false;
        }
        const clipping: boolean = ["overflow-x", "overflow-y"].some((property: string) => !["visible", "clip"].includes(this.keyword(values[property]) === "none" ? "visible" : this.keyword(values[property])));
        const clip: CssValue | undefined = values["clip"];
        const painted: boolean = (this.displays.containment(values, box.display, box.replaced) & DisplayTypes.PAINT_CONTAINMENT) !== 0;
        return !clipping && !painted && (clip === undefined || (clip.kind === "ident" && clip.lower === "auto"))
            && ["filter", "clip-path", "mask-image", "mask-border-source"].every((property: string) => PagePainter.isNone(values[property]));
    }

    private establish(entry: Layer, pdf: PdfPage, root: boolean): void {
        // CSS Transforms 2 §4.1.2: the box and the boxes that take part in its 3D rendering context are planes of one space,
        // drawn from the farthest to the nearest and cut where they cross; the parts in one plane keep the painting order.
        const saved: Space | undefined = this.space;
        const space: Space = { popped: new Set<BoxFragment>(), extending: new Set<BoxFragment>([entry.fragment]) };
        this.space = space;
        try {
            const own: Matrix4 = entry.matrix ?? SvgGeometry.IDENTITY4;
            const planes: Array<Plane> = [{ entry, matrix: own }];
            this.gather(entry, own, planes, space);
            const facets: Array<readonly [number, ReadonlyArray<readonly [number, number, number]>]> = [];
            planes.forEach((plane: Plane, index: number) => {
                const box: Box | undefined = this.ink(plane.entry, space);
                const points: Array<readonly [number, number, number]> = box === undefined ? [] : this.geometry.facet(plane.matrix, box);
                if (points.length >= 3) {
                    facets.push([index, points]);
                }
            });
            for (const [index, points] of this.geometry.depthOrder(facets)) {
                const plane: Plane = planes[index];
                pdf.content.save();
                points.forEach((point: readonly [number, number, number], position: number) => {
                    if (position === 0) {
                        pdf.content.moveTo(point[0], point[1]);
                    } else {
                        pdf.content.lineTo(point[0], point[1]);
                    }
                });
                pdf.content.closePath();
                pdf.content.clip(false);
                this.footprint = this.facetBox(points);
                this.transformed(plane.entry, plane.matrix, pdf, (target: PdfPage): void =>
                    this.clipped(plane.entry, target, (inner: PdfPage): void => this.stack(plane.entry, inner, root && index === 0)));
                delete this.footprint;
                pdf.content.restore();
            }
        } finally {
            if (saved === undefined) {
                delete this.space;
            } else {
                this.space = saved;
            }
        }
    }

    private facetBox(points: ReadonlyArray<readonly [number, number, number]>): Box {
        const xs: Array<number> = points.map((point: readonly [number, number, number]) => point[0]);
        const ys: Array<number> = points.map((point: readonly [number, number, number]) => point[1]);
        return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
    }

    private gather(entry: Layer, matrix: Matrix4, planes: Array<Plane>, space: Space): void {
        // CSS Transforms 2 §4.1.3: the children of a box that extends the context take part in it; one with a 3D transform gets a plane,
        // one without is drawn in its parent's plane, its own children taking part if it extends the context too.
        const layers: Array<Layer> = [];
        this.collect(entry.fragment, entry.transform, entry.frame, layers, true, [], undefined, undefined);
        for (const layer of layers) {
            if (layer.host !== entry.fragment.box || !this.displays.isTransformable(layer.fragment.box.display, layer.fragment.box.replaced)) {
                continue;
            }
            const own: Matrix4 = layer.matrix ?? SvgGeometry.IDENTITY4;
            const accumulated: Matrix4 = this.geometry.multiply4(matrix, own);
            const extends3d: boolean = this.preserves(layer);
            if (!this.geometry.planar(own)) {
                space.popped.add(layer.fragment);
                planes.push({ entry: layer, matrix: accumulated });
            }
            if (extends3d) {
                space.extending.add(layer.fragment);
                this.gather(layer, accumulated, planes, space);
            }
        }
    }

    private ink(entry: Layer, space: Space): Box | undefined {
        // What a plane shows: the boxes of the element and of its descendants that are not planes of their own.
        let box: Box | undefined;
        const walk: (fragment: BoxFragment, transform: Transform, frame: number) => void = (fragment: BoxFragment, transform: Transform, frame: number): void => {
            const area: readonly [number, number, number, number] = this.sizes.mapped(transform, fragment.inline, fragment.block, fragment.inlineSize, fragment.blockSize);
            box = this.geometry.union(box, [area[0], area[1], area[2], area[3]]);
            const inner: Transform = this.sizes.compose(transform, this.sizes.inside(fragment, frame));
            const own: number = this.sizes.frame(fragment.box.style);
            for (const child of fragment.children ?? []) {
                if (child.kind === "box") {
                    if (!space.popped.has(child)) {
                        walk(child, inner, own);
                    }
                    continue;
                }
                const line: Transform = this.lineTransform(inner, child);
                for (const piece of child.pieces) {
                    if (piece.kind === "box" && !space.popped.has(piece)) {
                        walk(piece, line, own);
                    }
                }
            }
        };
        walk(entry.fragment, entry.transform, entry.frame);
        return box;
    }

    private grouped(entry: Layer, pdf: PdfPage, draw: (target: PdfPage) => void): void {
        // Compositing 1 §3.1: the stacking context of a grouping box is painted into a group composited with the box's opacity and blend
        // mode as one object; the group is a form in the page's pixels and holds no tiling patterns, whose matrices a form would change.
        const grouping: Grouping | undefined = this.grouping(entry.fragment.box.style);
        if (grouping === undefined) {
            draw(pdf);
            return;
        }
        const area: Box = [this.reach.x, this.reach.y, this.reach.width, this.reach.height];
        const group: PdfPage = this.document.startForm(area[2], area[3], false);
        const base: Matrix = this.base;
        this.base = PathGeometry.IDENTITY;
        try {
            draw(group);
        } finally {
            this.base = base;
        }
        pdf.content.save();
        pdf.content.graphicsState(pdf.useState(grouping.alpha, grouping.alpha, grouping.blend));
        pdf.content.paintXObject(pdf.useImage(this.document.finishForm(group, area, PathGeometry.IDENTITY)));
        pdf.content.restore();
    }

    private clipped(entry: Layer, pdf: PdfPage, draw: (target: PdfPage) => void): void {
        // CSS Masking 1 §5.1: the clipping region restricts all that the box and its descendants paint, in the box's own space and before the
        // opacity of its group; a clipPath is a soft mask, put on a group of its own so that the masks inside cannot replace it.
        const fragment: BoxFragment = entry.fragment;
        const value: CssValue | undefined = fragment.box.style.values["clip-path"];
        if (value === undefined || PagePainter.isNone(value)) {
            draw(pdf);
            return;
        }
        const url: CssValue | undefined = (value.kind === "list" ? value.items : [value]).find((item: CssValue) => item.kind === "url");
        if (url === undefined || url.kind !== "url") {
            const shape: readonly [SvgPath, boolean] | null = this.clipShape(fragment, entry.transform, value);
            pdf.content.save();
            if (shape === null) {
                pdf.content.rectangle(0, 0, 0, 0);
                pdf.content.clip(false);
            } else {
                this.geometry.emit(shape[0], undefined, pdf.content);
                pdf.content.clip(shape[1]);
            }
            draw(pdf);
            pdf.content.restore();
            return;
        }
        const place: Box = this.clipReference(fragment, entry.transform);
        const area: Box = [this.reach.x, this.reach.y, this.reach.width, this.reach.height];
        const mask: ImageResource | null | undefined = this.setup.images.clip(url.href, pdf, place, [area[0] - place[0], area[1] - place[1], area[2], area[3]],
            this.boxesOf(fragment, entry.transform, place), this.keyword(fragment.box.style.values["direction"]) === "rtl", this.scaleAt(place));
        if (mask === undefined) {
            draw(pdf);
            return;
        }
        // §6.1: "An empty clipping path will completely clip away the element", whose destinations are still on the page.
        if (mask === null) {
            pdf.content.save();
            pdf.content.rectangle(0, 0, 0, 0);
            pdf.content.clip(false);
            draw(pdf);
            pdf.content.restore();
            return;
        }
        const group: PdfPage = this.document.startForm(area[2], area[3], false);
        const base: Matrix = this.base;
        this.base = PathGeometry.IDENTITY;
        try {
            draw(group);
        } finally {
            this.base = base;
        }
        pdf.content.save();
        pdf.content.transform(1, 0, 0, 1, place[0], place[1]);
        pdf.content.graphicsState(pdf.useMask(mask.object, true));
        pdf.content.transform(1, 0, 0, 1, -place[0], -place[1]);
        pdf.content.paintXObject(pdf.useImage(this.document.finishForm(group, area, PathGeometry.IDENTITY)));
        pdf.content.restore();
    }

    private clipShape(fragment: BoxFragment, transform: Transform, value: CssValue): readonly [SvgPath, boolean] | null {
        // CSS Masking 1 §5.1: a basic shape in its reference box, border-box when none is given, or the box alone with its corners (CSS Shapes 1
        // §5); for a box of the CSS box model fill-box is the content box, and stroke-box and view-box are the border box.
        const items: ReadonlyArray<CssValue> = value.kind === "list" ? value.items : [value];
        const shape: CssValue | undefined = items.find((item: CssValue) => item.kind === "function");
        const named: CssValue | undefined = items.find((item: CssValue) => item.kind === "ident");
        const [rectangle, radii]: readonly [Rectangle, CornerRadii] = this.shapeBox(fragment, transform, named === undefined ? "border-box" : this.keyword(named));
        if (shape === undefined) {
            return [this.roundedPath(rectangle, radii), false];
        }
        return this.geometry.basicShape(shape, [rectangle.x, rectangle.y, rectangle.width, rectangle.height], this.keyword(fragment.box.style.values["direction"]) === "rtl") ?? null;
    }

    private shapeBox(fragment: BoxFragment, transform: Transform, name: string): readonly [Rectangle, CornerRadii] {
        // CSS Shapes 1 §5: a padding box has the inner curves of the border, a content box radii less its borders and padding, and a margin box
        // radii grown with its margins; CSS Fragmentation 4 §5.4: the reference box of a sliced box is that of the whole box.
        const whole: WholeGeometry | undefined = this.wholeGeometry(fragment, transform);
        const area: readonly [number, number, number, number] = this.sizes.mapped(transform, fragment.inline, fragment.block, fragment.inlineSize, fragment.blockSize);
        const border: Rectangle = whole?.area ?? { x: area[0], y: area[1], width: area[2], height: area[3] };
        const radii: CornerRadii = this.radii(fragment.box.style, border);
        const [borders, padding]: readonly [PhysicalSides, PhysicalSides] = whole === undefined ? this.edges(fragment) : [whole.border, whole.padding];
        switch (name) {
            case "padding-box":
                return this.borders.inner(border, borders, radii);
            case "content-box":
            case "fill-box":
                return this.borders.inner(border, [borders[0] + padding[0], borders[1] + padding[1], borders[2] + padding[2], borders[3] + padding[3]], radii);
            case "margin-box": {
                const margins: PhysicalSides = whole?.margin ?? this.usedMargins(fragment);
                const grown: (radius: number, margin: number) => number = (radius: number, margin: number): number =>
                    margin <= 0 || radius >= margin ? Math.max(radius + margin, 0) : radius + margin * (1 + (radius / margin - 1) ** 3);
                const outer: Rectangle = { x: border.x - margins[3], y: border.y - margins[0], width: border.width + margins[1] + margins[3],
                    height: border.height + margins[0] + margins[2] };
                return [outer, [grown(radii[0], margins[3]), grown(radii[1], margins[0]), grown(radii[2], margins[1]), grown(radii[3], margins[0]),
                    grown(radii[4], margins[1]), grown(radii[5], margins[2]), grown(radii[6], margins[3]), grown(radii[7], margins[2])]];
            }
            default:
                return [border, radii];
        }
    }

    private roundedPath(rectangle: Rectangle, radii: CornerRadii): SvgPath {
        // CSS Backgrounds 3 §4.4: each corner a quarter ellipse of its two radii, and square where either is zero.
        const right: number = rectangle.x + rectangle.width;
        const bottom: number = rectangle.y + rectangle.height;
        const corner: (rx: number, ry: number, x: number, y: number) => string = (rx: number, ry: number, x: number, y: number): string =>
            rx > 0 && ry > 0 ? "A" + rx + " " + ry + " 0 0 1 " + x + " " + y : "L" + x + " " + y;
        return this.geometry.parse("M" + (rectangle.x + radii[0]) + " " + rectangle.y + "H" + (right - radii[2]) + corner(radii[2], radii[3], right, rectangle.y + radii[3])
            + "V" + (bottom - radii[5]) + corner(radii[4], radii[5], right - radii[4], bottom) + "H" + (rectangle.x + radii[6])
            + corner(radii[6], radii[7], rectangle.x, bottom - radii[7]) + "V" + (rectangle.y + radii[1]) + corner(radii[0], radii[1], rectangle.x + radii[0], rectangle.y) + "Z");
    }

    private boxesOf(fragment: BoxFragment, transform: Transform, place: Box): (kind: string) => Box | undefined {
        // The object bounding box of a box of the CSS box model is its content box, which fill-box names, and stroke-box is its border box,
        // both in the user space whose origin is at the top left of the reference box.
        return (kind: string): Box | undefined => {
            const [rectangle]: readonly [Rectangle, CornerRadii] = this.shapeBox(fragment, transform, kind === "fill" ? "content-box" : "border-box");
            return [rectangle.x - place[0], rectangle.y - place[1], rectangle.width, rectangle.height];
        };
    }

    private scaleAt(place: Box): number {
        // How many pixels of the page a pixel of the box covers, for the precision of the curves of a clipPath.
        const tangent: Matrix | undefined = this.lens === undefined ? undefined : this.geometry.tangent(this.lens, place[0] + place[2] / 2, place[1] + place[3] / 2);
        return tangent === undefined ? 1 : Math.sqrt(Math.abs(tangent[0] * tangent[3] - tangent[1] * tangent[2]));
    }

    private clipRegion(fragment: BoxFragment, transform: Transform): Array<Array<readonly [SvgPath, boolean]>> | null | undefined {
        // The clipping region of a clip-path in the box's own space, a union of parts that are each the intersection of outlines: none when
        // nothing clips, and null when all is clipped away.
        const value: CssValue | undefined = fragment.box.style.values["clip-path"];
        if (value === undefined || PagePainter.isNone(value)) {
            return undefined;
        }
        const url: CssValue | undefined = (value.kind === "list" ? value.items : [value]).find((item: CssValue) => item.kind === "url");
        if (url === undefined || url.kind !== "url") {
            const shape: readonly [SvgPath, boolean] | null = this.clipShape(fragment, transform, value);
            return shape === null ? null : [[shape]];
        }
        const place: Box = this.clipReference(fragment, transform);
        const parts: Array<Array<readonly [SvgPath, boolean]>> | null | undefined = this.setup.images.clipOutlines(url.href, place, this.boxesOf(fragment, transform, place),
            this.keyword(fragment.box.style.values["direction"]) === "rtl");
        return parts === null || parts === undefined ? parts : parts.map((part: Array<readonly [SvgPath, boolean]>) => part.map((outline: readonly [SvgPath, boolean]):
            readonly [SvgPath, boolean] => [this.geometry.transformPath(outline[0], [1, 0, 0, 1, place[0], place[1]]), outline[1]]));
    }

    private wholeGeometry(fragment: BoxFragment, transform: Transform): WholeGeometry | undefined {
        // The composite box of a sliced fragment, on the page: its border box, its edges on the box's own sides, and the area that sizes an image
        // derived from the extent across the joined axis, which "is calculated using the widest fragment's width".
        const whole: WholeBox | undefined = fragment.whole;
        if (whole === undefined) {
            return undefined;
        }
        const [inline, block, inlineSize, blockSize]: ObjectArea = whole.area;
        const area: readonly [number, number, number, number] = this.sizes.mapped(transform, inline, block, inlineSize, blockSize);
        const sizing: readonly [number, number, number, number] = this.sizes.mapped(transform, inline, block, whole.joinedInline ? inlineSize : whole.cross,
            whole.joinedInline ? whole.cross : blockSize);
        const own: number = this.sizes.frame(fragment.box.style);
        const physical: (sides: Sides) => PhysicalSides = (sides: Sides): PhysicalSides => {
            const result: [number, number, number, number] = [0, 0, 0, 0];
            for (let side: number = 0; side < 4; side++) {
                result[this.sizes.physicalSide(own, side)] = sides[side];
            }
            return result;
        };
        return {
            area: { x: area[0], y: area[1], width: area[2], height: area[3] }, margin: physical(whole.margin), border: physical(whole.border), padding: physical(whole.padding),
            sizing: { x: sizing[0], y: sizing[1], width: sizing[2], height: sizing[3] }
        };
    }

    private usedMargins(fragment: BoxFragment): PhysicalSides {
        // The used margins of a fragment are on the sides of its own writing mode, as its borders are.
        const own: number = this.sizes.frame(fragment.box.style);
        const margins: [number, number, number, number] = [0, 0, 0, 0];
        for (let side: number = 0; side < 4; side++) {
            margins[this.sizes.physicalSide(own, side)] = fragment.margin === undefined ? 0 : fragment.margin[side];
        }
        return margins;
    }

    private transformed(entry: Layer, matrix: Matrix4, pdf: PdfPage, draw: (target: PdfPage) => void): void {
        // CSS Transforms 1 §10: "If a transform function causes the current transformation matrix of an object to be
        // non-invertible, the object and its content do not get displayed."
        const limit: Box | undefined = this.footprint;
        delete this.footprint;
        const flat: Matrix | null | undefined = this.geometry.flatten(matrix);
        const homography: Homography = this.geometry.homography(matrix);
        const inverse: Homography | undefined = this.geometry.invertHomography(homography);
        if (flat === null || inverse === undefined || (flat !== undefined && this.geometry.invert(flat) === undefined)) {
            return;
        }
        // CSS Transforms 2 §10: with backface-visibility hidden the box is not drawn when its back faces the viewer.
        if (this.keyword(entry.fragment.box.style.values["backface-visibility"]) === "hidden" && matrix[10] < 0) {
            return;
        }
        // What the page shows of the local plane is what the inverse of the transform takes the visible area to.
        let inside: Box | undefined;
        const visible: SvgPath = this.geometry.rectangle(this.reach.x, this.reach.y, this.reach.width, this.reach.height, 0, 0);
        for (const polygon of this.geometry.projected(visible, inverse, 1)) {
            for (const point of polygon) {
                inside = this.geometry.union(inside, [point[0], point[1], 0, 0]);
            }
        }
        if (inside === undefined) {
            return;
        }
        const saved: readonly [Homography | undefined, Rectangle, Matrix, boolean] = [this.lens, this.reach, this.base, this.moved];
        const outer: Rectangle = this.reach;
        this.lens = this.geometry.composeHomography(this.lens ?? PathGeometry.IDENTITY3, homography);
        this.reach = { x: inside[0], y: inside[1], width: inside[2], height: inside[3] };
        this.moved = true;
        try {
            if (flat !== undefined) {
                pdf.content.save();
                pdf.content.transform(flat[0], flat[1], flat[2], flat[3], flat[4], flat[5]);
                this.base = this.geometry.concat(saved[2], flat);
                this.grouped(entry, pdf, draw);
                pdf.content.restore();
            } else {
                this.projected(entry, homography, inverse, outer, limit, pdf, draw);
            }
        } finally {
            if (saved[0] === undefined) {
                delete this.lens;
            } else {
                this.lens = saved[0];
            }
            this.reach = saved[1];
            this.base = saved[2];
            this.moved = saved[3];
        }
    }

    private limited(limit: Box | undefined, draw: () => void): void {
        if (limit !== undefined) {
            this.footprint = limit;
        }
        try {
            draw();
        } finally {
            delete this.footprint;
        }
    }

    private projected(entry: Layer, homography: Homography, inverse: Homography, outer: Rectangle, limit: Box | undefined, pdf: PdfPage, draw: (target: PdfPage) => void): void {
        // A projection is not an affine map, which a PDF can apply to a form. The page's area is cut into cells in which the
        // map is affine to within a fraction of a pixel, and each cell shows the form of the layer through its own map.
        const area: Box = [this.reach.x, this.reach.y, this.reach.width, this.reach.height];
        const form: PdfPage = this.document.startForm(area[2], area[3], false);
        this.base = PathGeometry.IDENTITY;
        draw(form);
        const content: ImageResource = this.document.finishForm(form, area, PathGeometry.IDENTITY);
        const grouping: Grouping | undefined = this.grouping(entry.fragment.box.style);
        const cell: Box = [outer.x, outer.y, outer.width, outer.height];
        if (grouping === undefined) {
            this.limited(limit, () => this.tiles(pdf, content, homography, inverse, cell));
            return;
        }
        const group: PdfPage = this.document.startForm(cell[2], cell[3], false);
        this.limited(limit, () => this.tiles(group, content, homography, inverse, cell));
        pdf.content.save();
        pdf.content.graphicsState(pdf.useState(grouping.alpha, grouping.alpha, grouping.blend));
        pdf.content.paintXObject(pdf.useImage(this.document.finishForm(group, cell, PathGeometry.IDENTITY)));
        pdf.content.restore();
    }

    private tiles(page: PdfPage, content: ImageResource, homography: Homography, inverse: Homography, cell: Box): void {
        // The affine map of a cell is the tangent of the inverse projection at its center; it holds when corners and side middles, taken back
        // by it and projected again, land within CELL_ERROR; a cell under CELL_FLOOR shows no difference, and w not positive shows nothing.
        const [x, y, width, height]: Box = cell;
        const samples: ReadonlyArray<readonly [number, number]> = [
            [x, y], [x + width, y], [x, y + height], [x + width, y + height], [x + width / 2, y], [x + width / 2, y + height], [x, y + height / 2], [x + width, y + height / 2],
            [x + width / 2, y + height / 2]
        ];
        // A cell outside of the footprint of the plane has nothing of it, nor has one that lies wholly behind the viewer.
        const footprint: Box | undefined = this.footprint;
        if ((footprint !== undefined && (x > footprint[0] + footprint[2] || x + width < footprint[0] || y > footprint[1] + footprint[3] || y + height < footprint[1]))
            || samples.every((sample: readonly [number, number]) => this.geometry.project(inverse, sample[0], sample[1]) === undefined)) {
            return;
        }
        const approximation: Matrix | undefined = this.geometry.tangent(inverse, x + width / 2, y + height / 2);
        let error: number = approximation === undefined ? Number.POSITIVE_INFINITY : 0;
        for (const sample of samples) {
            const source: readonly [number, number] | undefined = approximation === undefined ? undefined : this.geometry.point(approximation, sample[0], sample[1]);
            const back: readonly [number, number] | undefined = source === undefined || this.geometry.project(inverse, sample[0], sample[1]) === undefined ? undefined
                : this.geometry.project(homography, source[0], source[1]);
            error = back === undefined ? Number.POSITIVE_INFINITY : Math.max(error, Math.hypot(back[0] - sample[0], back[1] - sample[1]));
        }
        if (error > CELL_ERROR && (width >= 2 * CELL_FLOOR || height >= 2 * CELL_FLOOR)) {
            const across: boolean = width >= height;
            const first: Box = across ? [x, y, width / 2, height] : [x, y, width, height / 2];
            const second: Box = across ? [x + width / 2, y, width / 2, height] : [x, y + height / 2, width, height / 2];
            this.tiles(page, content, homography, inverse, first);
            this.tiles(page, content, homography, inverse, second);
            return;
        }
        const forward: Matrix | undefined = approximation === undefined || error === Number.POSITIVE_INFINITY ? undefined : this.geometry.invert(approximation);
        if (forward === undefined) {
            return;
        }
        page.content.save();
        page.content.rectangle(x - CELL_OVERLAP, y - CELL_OVERLAP, width + 2 * CELL_OVERLAP, height + 2 * CELL_OVERLAP);
        page.content.clip(false);
        page.content.transform(forward[0], forward[1], forward[2], forward[3], forward[4], forward[5]);
        page.content.paintXObject(page.useImage(content));
        page.content.restore();
    }

    private stack(entry: Layer, pdf: PdfPage, root: boolean, inside: boolean = false, own: boolean = true): void {
        // CSS 2 Appendix E.2 gives the order; a formula's math element has its own box painted by the replaced box that shows the formula.
        if (this.veiled(entry.fragment)) {
            this.veiledMarks(entry.fragment, entry.transform, entry.frame, undefined, false);
            return;
        }
        const layers: Array<Layer> = [];
        const clips: ReadonlyArray<Clip> = inside ? entry.clips : [];
        this.collect(entry.fragment, entry.transform, entry.frame, layers, true, inside ? entry.held ?? [] : [], undefined, undefined);
        if (own) {
            this.enter(clips, pdf);
            this.box(entry.fragment, entry.transform, entry.frame, pdf, root);
            this.leave(clips, pdf);
        }
        const order: (first: Layer, second: Layer) => number = (first: Layer, second: Layer): number => first.z - second.z;
        for (const layer of layers.filter((candidate: Layer) => candidate.context && candidate.z < 0).sort(order)) {
            this.context(layer, pdf, false);
        }
        this.enter(clips, pdf);
        this.content(entry, pdf, own);
        this.leave(clips, pdf);
        for (const layer of layers.filter((candidate: Layer) => !candidate.context || candidate.z === 0)) {
            if (layer.context) {
                this.context(layer, pdf, false);
            } else {
                this.atomically(layer, pdf);
            }
        }
        for (const layer of layers.filter((candidate: Layer) => candidate.context && candidate.z > 0).sort(order)) {
            this.context(layer, pdf, false);
        }
    }

    private atomically(entry: Layer, pdf: PdfPage): void {
        // Appendix E.2: floats, atomic inlines and positioned boxes with z-index auto paint "as if it created a new stacking
        // context", their positioned and stacking descendants staying in the parent stacking context.
        if (this.veiled(entry.fragment)) {
            return;
        }
        this.enter(entry.clips, pdf);
        this.box(entry.fragment, entry.transform, entry.frame, pdf, false);
        this.content(entry, pdf);
        this.leave(entry.clips, pdf);
    }

    private enter(clips: ReadonlyArray<Clip>, pdf: PdfPage): void {
        // A positioned box painted from its stacking context is still clipped by the boxes that clip its containing block.
        if (clips.length > 0) {
            pdf.content.save();
            for (const clip of clips) {
                this.borders.shape(clip.rectangle, clip.radii, pdf);
                pdf.content.clip(false);
            }
        }
    }

    private leave(clips: ReadonlyArray<Clip>, pdf: PdfPage): void {
        if (clips.length > 0) {
            pdf.content.restore();
        }
    }

    private content(entry: Layer, pdf: PdfPage, own: boolean = true): void {
        // CSS Text Decoration 4 §2: decorations are not propagated to out-of-flow boxes nor into atomic inlines, so what is
        // painted as a stacking context starts with its own decorations only.
        if (entry.fragment.box.replaced) {
            this.replaced(entry.fragment, entry.transform, entry.frame, pdf);
            return;
        }
        const inner: Transform = this.sizes.compose(entry.transform, this.sizes.inside(entry.fragment, entry.frame));
        const frame: number = this.sizes.frame(entry.fragment.box.style);
        const clipped: boolean = own && this.clip(entry.fragment, entry.transform, pdf);
        this.blocks(entry.fragment, inner, frame, pdf);
        this.floats(entry.fragment, inner, frame, pdf);
        this.inlines(entry.fragment, inner, frame, pdf, this.decorated([], entry.fragment.box.style));
        const slice: InlineSlice | undefined = entry.line;
        if (slice !== undefined) {
            // CSS 2 Appendix E.2: an inline box painted from a layer of its own paints its contents with it, which are the pieces of its line that it holds.
            const owners: Map<TextPiece | BoxFragment, BoxFragment> = this.owners(slice.line);
            this.linePieces(slice.line, slice.line.pieces.filter((piece: TextPiece | BoxFragment) => owners.get(piece) === entry.fragment), slice.transform, entry.frame, pdf,
                slice.decorators);
        }
        if (clipped) {
            pdf.content.restore();
        }
    }

    private replaced(fragment: BoxFragment, transform: Transform, frame: number, pdf: PdfPage): void {
        const clipped: boolean = this.clip(fragment, transform, pdf);
        this.linked(this.images.paint(fragment, transform, frame, pdf, this.moved ? undefined : this.page));
        if (clipped) {
            pdf.content.restore();
        }
    }

    private clip(fragment: BoxFragment, transform: Transform, pdf: PdfPage): boolean {
        const clip: Clip | undefined = this.clipOf(fragment, transform);
        if (clip === undefined) {
            return false;
        }
        pdf.content.save();
        this.borders.shape(clip.rectangle, clip.radii, pdf);
        pdf.content.clip(false);
        return true;
    }

    private clipOf(fragment: BoxFragment, transform: Transform): Clip | undefined {
        const area: ClipArea | undefined = this.clipArea(fragment, transform);
        if (area === undefined) {
            return undefined;
        }
        // A clip is a closed path, so in the axis that does not clip it spans what the page shows, whose MediaBox ends what can be seen.
        const clip: Rectangle = { ...area.rectangle };
        if (!area.across) {
            clip.x = this.reach.x;
            clip.width = this.reach.width;
        }
        if (!area.down) {
            clip.y = this.reach.y;
            clip.height = this.reach.height;
        }
        return { rectangle: clip, radii: area.across && area.down ? area.radii : NO_RADII };
    }

    private clipArea(fragment: BoxFragment, transform: Transform): ClipArea | undefined {
        // CSS Overflow 3 §3: the content is clipped to the padding box only in the axes that clip.
        const values: Readonly<Record<string, CssValue>> = fragment.box.style.values;
        // CSS Containment 2 §3.4: with paint containment "the contents of the element including any ink or scrollable overflow must be clipped to
        // the overflow clip edge of the paint containment box, taking corners into account."
        const contained: boolean = (this.displays.containment(values, fragment.box.display, fragment.box.replaced) & DisplayTypes.PAINT_CONTAINMENT) !== 0;
        const across: boolean = contained || CLIPPING.has(this.keyword(values["overflow-x"]));
        const down: boolean = contained || CLIPPING.has(this.keyword(values["overflow-y"]));
        // An image that is not clipped to its box of its own has only what overflow says, "any overflow of replaced content" being ink overflow.
        if ((!across && !down) || (fragment.box.replaced && !this.images.unclipped(fragment))) {
            return undefined;
        }
        const area: readonly [number, number, number, number] = this.sizes.mapped(transform, fragment.inline, fragment.block, fragment.inlineSize, fragment.blockSize);
        const rectangle: Rectangle = { x: area[0], y: area[1], width: area[2], height: area[3] };
        const edges: readonly [PhysicalSides, PhysicalSides] = this.edges(fragment);
        const inner: readonly [Rectangle, CornerRadii] = this.borders.inner(rectangle, edges[0], this.radii(fragment.box.style, rectangle));
        return { rectangle: inner[0], radii: inner[1], across, down };
    }

    private veiled(fragment: BoxFragment): boolean {
        // CSS Display 4 §5: with force-hidden "Any boxes generated by the element and its descendants are invisible (regardless of their
        // visibility value)"; CSS Anchor Positioning 1 §6.6 makes a box that position-visibility hides force-hidden.
        return fragment.hidden === true || this.keyword(fragment.box.style.values["visibility"]) === "force-hidden";
    }

    private veiledMarks(fragment: BoxFragment, transform: Transform, frame: number, view: Matrix4 | undefined, transforms: boolean): void {
        // CSS Display 4 §5: invisible boxes "still affect layout", so the destinations of their elements stay where they are, as those of boxes
        // with visibility hidden do; a box's own transform places them unless the caller drew it already.
        const box: ElementBox = fragment.box;
        if (box.placement === "running" || box.placement === "footnote" || box.placement === "page-float") {
            return;
        }
        const matrix: Matrix4 | undefined = transforms ? this.matrixOf(fragment, transform, view) : undefined;
        const homography: Homography | undefined = matrix === undefined ? undefined : this.geometry.homography(matrix);
        if (homography !== undefined && this.geometry.invertHomography(homography) === undefined) {
            return;
        }
        const saved: Homography | undefined = this.lens;
        if (homography !== undefined) {
            this.lens = this.geometry.composeHomography(saved ?? PathGeometry.IDENTITY3, homography);
        }
        try {
            const area: readonly [number, number, number, number] = this.sizes.mapped(transform, fragment.inline, fragment.block, fragment.inlineSize, fragment.blockSize);
            this.anchor(fragment, { x: area[0], y: area[1], width: area[2], height: area[3] }, true);
            const inner: Transform = this.sizes.compose(transform, this.sizes.inside(fragment, frame));
            const own: number = this.sizes.frame(box.style);
            const eye: Matrix4 | undefined = this.named(fragment) ? this.eye(fragment, transform) : view;
            for (const child of fragment.children ?? []) {
                if (child.kind === "box") {
                    this.veiledMarks(child, inner, own, eye, true);
                    continue;
                }
                const line: Transform = this.lineTransform(inner, child);
                for (const piece of child.pieces) {
                    if (piece.kind === "box") {
                        this.veiledMarks(piece, line, own, eye, true);
                    }
                }
            }
        } finally {
            if (saved === undefined) {
                delete this.lens;
            } else {
                this.lens = saved;
            }
        }
    }

    private named(fragment: BoxFragment): boolean {
        return this.transforms.named(fragment);
    }

    private anchorVisibility(roots: ReadonlyArray<Layer>): void {
        // CSS Anchor Positioning 1 §6.6: anchors-visible hides a box whose default anchor box "is invisible or clipped by intervening boxes", which
        // what is painted decides; in tree order, so that an anchor hidden this way hides the boxes anchored to it.
        const anchored: Array<readonly [BoxFragment, AnchorLink]> = [];
        const wanted: Set<SourceElement | ElementBox> = new Set<SourceElement | ElementBox>();
        for (const root of roots) {
            this.placements(root.fragment, root.transform, root.frame, undefined, [], (chain: ReadonlyArray<Placed>): void => {
                const fragment: BoxFragment = chain[chain.length - 1].fragment;
                if (fragment.anchoredTo !== undefined) {
                    anchored.push([fragment, fragment.anchoredTo]);
                    wanted.add(this.anchorKey(fragment.anchoredTo.anchor));
                }
            });
        }
        if (anchored.length === 0) {
            return;
        }
        // The anchor box is the element's principal box, whose fragments may belong to several boxes of the element: the parts of an inline box that
        // blocks split, and the copies that its first line makes.
        const anchors: Map<SourceElement | ElementBox, Array<ReadonlyArray<Placed>>> = new Map<SourceElement | ElementBox, Array<ReadonlyArray<Placed>>>();
        for (const root of roots) {
            this.placements(root.fragment, root.transform, root.frame, undefined, [], (chain: ReadonlyArray<Placed>): void => {
                const key: SourceElement | ElementBox = this.anchorKey(chain[chain.length - 1].fragment.box);
                if (wanted.has(key)) {
                    const known: Array<ReadonlyArray<Placed>> = anchors.get(key) ?? [];
                    known.push([...chain]);
                    anchors.set(key, known);
                }
            });
        }
        for (const [fragment, link] of anchored) {
            // An anchor in several fragments is seen when one of them is.
            const places: ReadonlyArray<ReadonlyArray<Placed>> | undefined = anchors.get(this.anchorKey(link.anchor));
            if (places !== undefined && places.every((chain: ReadonlyArray<Placed>) => !this.anchorShown(chain, link.container))) {
                fragment.hidden = true;
            }
        }
    }

    private anchorKey(box: ElementBox): SourceElement | ElementBox {
        // An element is its own key; the boxes of one of its pseudo-elements, the copies that the first line makes included, share the first one met.
        if (box.element === undefined) {
            return box;
        }
        if (box.pseudoElement === undefined) {
            return box.element;
        }
        const byPseudo: Map<string, ElementBox> = this.pseudoKeys.get(box.element) ?? new Map<string, ElementBox>();
        this.pseudoKeys.set(box.element, byPseudo);
        const known: ElementBox = byPseudo.get(box.pseudoElement) ?? box;
        byPseudo.set(box.pseudoElement, known);
        return known;
    }

    private placements(fragment: BoxFragment, transform: Transform, frame: number, view: Matrix4 | undefined, chain: Array<Placed>,
        visit: (chain: ReadonlyArray<Placed>) => void): void {
        // Each box of the page with the boxes it is in, from the root, and the transforms that place them as collect() does.
        chain.push({ fragment, transform, frame, view });
        visit(chain);
        const inner: Transform = this.sizes.compose(transform, this.sizes.inside(fragment, frame));
        const own: number = this.sizes.frame(fragment.box.style);
        const eye: Matrix4 | undefined = this.named(fragment) ? this.eye(fragment, transform) : view;
        for (const child of fragment.children ?? []) {
            if (child.kind === "box") {
                this.placements(child, inner, own, eye, chain, visit);
                continue;
            }
            const line: Transform = this.lineTransform(inner, child);
            for (const piece of child.pieces) {
                if (piece.kind === "box") {
                    this.placements(piece, line, own, eye, chain, visit);
                }
            }
        }
        chain.pop();
    }

    private anchorShown(chain: ReadonlyArray<Placed>, container: ElementBox): boolean {
        // §6.6: an anchor is invisible with visibility hidden, collapse or force-hidden, its own or that of a box it is in; it is clipped when
        // "fully clipped by a box which is an ancestor of anchor but a descendant of abspos's containing block", by overflow or paint containment.
        const anchor: Placed = chain[chain.length - 1];
        if (HIDDEN.has(this.keyword(anchor.fragment.box.style.values["visibility"])) || chain.some((placed: Placed) => this.veiled(placed.fragment))) {
            return false;
        }
        let ink: Box | undefined = this.inkOf(anchor.fragment, anchor.transform, anchor.frame, anchor.view, this.carried(chain));
        if (ink === undefined) {
            return false;
        }
        // "If anchor has non-zero area, it must also have a non-zero intersection area to be considered not fully clipped."
        const solid: boolean = ink[2] > 0 && ink[3] > 0;
        let first: number = 0;
        for (let index: number = chain.length - 2; index >= 0; index--) {
            if (chain[index].fragment.box === container) {
                first = index + 1;
                break;
            }
        }
        // The clip of a box is in the space of its own transform, which takes it and what it holds to the space of its parent.
        for (let index: number = chain.length - 2; index >= first && ink !== undefined; index--) {
            const between: Placed = chain[index];
            const clip: ClipArea | undefined = this.clipArea(between.fragment, between.transform);
            const region: Array<Array<readonly [SvgPath, boolean]>> | null | undefined = this.clipRegion(between.fragment, between.transform);
            if ((clip !== undefined && !PagePainter.touches(ink, clip, solid)) || region === null || (region !== undefined && !this.inRegion(ink, region, solid))) {
                return false;
            }
            const matrix: Matrix4 | undefined = this.matrixOf(between.fragment, between.transform, between.view);
            ink = matrix === undefined ? ink : this.projectedBox(ink, matrix);
        }
        return ink !== undefined;
    }

    private carried(chain: ReadonlyArray<Placed>): ReadonlyArray<ComputedStyle> {
        // CSS Text Decoration 4 §2: the decorations of the boxes around reach the in-flow block-level descendants, not the out-of-flow boxes and
        // atomic inlines, which start with their own.
        let decorators: ReadonlyArray<ComputedStyle> = [];
        for (let index: number = 0; index < chain.length - 1; index++) {
            const box: ElementBox = chain[index].fragment.box;
            decorators = this.decorated(this.carries(box) ? decorators : [], box.style);
        }
        return this.carries(chain[chain.length - 1].fragment.box) ? decorators : [];
    }

    private carries(box: ElementBox): boolean {
        return !this.isLayered(box) && box.placement !== "float" && !box.replaced && !(box.display.outer === "inline" && !this.displays.isInlineBox(box.display));
    }

    private inkOf(fragment: BoxFragment, transform: Transform, frame: number, view: Matrix4 | undefined, inherited: ReadonlyArray<ComputedStyle>): Box | undefined {
        // CSS Overflow 3 §2.2: the ink overflow rectangle holds the border box and the ink of what the box and its descendants paint beyond it,
        // which the box's own clip cuts; the box's transform moves all of it. A box that is not painted adds nothing.
        if (this.veiled(fragment)) {
            return undefined;
        }
        const area: readonly [number, number, number, number] = this.sizes.mapped(transform, fragment.inline, fragment.block, fragment.inlineSize, fragment.blockSize);
        const content: Box | undefined = this.contentInk(fragment, transform, frame, view, this.decorated(inherited, fragment.box.style));
        const clip: ClipArea | undefined = this.clipArea(fragment, transform);
        let ink: Box | undefined = this.geometry.union([area[0], area[1], area[2], area[3]], content === undefined || clip === undefined ? content : PagePainter.cut(content, clip));
        // CSS Masking 1 §5.1: a clip-path cuts all that the box paints, its border box with the rest.
        const region: Array<Array<readonly [SvgPath, boolean]>> | null | undefined = this.clipRegion(fragment, transform);
        if (region !== undefined && ink !== undefined) {
            // The bounds of the region: of each part those that all its outlines share.
            let bounds: Box | undefined;
            for (const part of region ?? []) {
                let shared: Box | undefined = ink;
                for (const [path] of part) {
                    const box: Box | undefined = this.geometry.bounds(path, PathGeometry.IDENTITY);
                    shared = shared === undefined || box === undefined ? undefined : PagePainter.cut(shared, PagePainter.area(box));
                }
                bounds = this.geometry.union(bounds, shared);
            }
            ink = bounds;
        }
        const matrix: Matrix4 | undefined = this.matrixOf(fragment, transform, view);
        return ink === undefined || matrix === undefined ? ink : this.projectedBox(ink, matrix);
    }

    private contentInk(fragment: BoxFragment, transform: Transform, frame: number, view: Matrix4 | undefined, decorators: ReadonlyArray<ComputedStyle>): Box | undefined {
        // The ink of what a box holds: its descendants, the text of its lines with their decorations, and what it draws of its own.
        const inner: Transform = this.sizes.compose(transform, this.sizes.inside(fragment, frame));
        let content: Box | undefined;
        if (fragment.box.replaced) {
            // An image that is not clipped to its box of its own reaches as far as its object-fit area.
            const object: readonly [number, number, number, number] | undefined = fragment.object;
            if (object !== undefined && this.images.unclipped(fragment)) {
                const placed: readonly [number, number, number, number] = this.sizes.mapped(inner, object[0], object[1], object[2], object[3]);
                content = [placed[0], placed[1], placed[2], placed[3]];
            }
            return content;
        }
        if (this.drawing !== undefined && !HIDDEN.has(this.keyword(fragment.box.style.values["visibility"]))) {
            content = this.drawing.ink(fragment, inner);
        }
        const own: number = this.sizes.frame(fragment.box.style);
        const eye: Matrix4 | undefined = this.named(fragment) ? this.eye(fragment, transform) : view;
        for (const child of fragment.children ?? []) {
            if (child.kind === "box") {
                content = this.geometry.union(content, this.inkOf(child, inner, own, eye, this.carries(child.box) ? decorators : []));
                continue;
            }
            content = this.geometry.union(content, this.text.lineInk(child, inner, decorators));
            const line: Transform = this.lineTransform(inner, child);
            for (const piece of child.pieces) {
                if (piece.kind === "box") {
                    content = this.geometry.union(content, this.inkOf(piece, line, own, eye, []));
                }
            }
        }
        return content;
    }

    static cut(box: Box, clip: ClipArea): Box | undefined {
        // What a clip keeps of a box, in the axes it clips.
        const area: Rectangle = clip.rectangle;
        const left: number = clip.across ? Math.max(box[0], area.x) : box[0];
        const right: number = clip.across ? Math.min(box[0] + box[2], area.x + area.width) : box[0] + box[2];
        const top: number = clip.down ? Math.max(box[1], area.y) : box[1];
        const bottom: number = clip.down ? Math.min(box[1] + box[3], area.y + area.height) : box[1] + box[3];
        return right < left || bottom < top ? undefined : [left, top, right - left, bottom - top];
    }

    static touches(ink: Box, clip: ClipArea, solid: boolean): boolean {
        // Whether the clip leaves something of the ink, with area when the ink has area; CSS Backgrounds 3 §4.4: the curve of a rounded corner
        // clips what lies outside it, so ink inside the square of one corner is seen only where it reaches inside the ellipse.
        const kept: Box | undefined = PagePainter.cut(ink, clip);
        if (kept === undefined || (solid && (kept[2] <= 0 || kept[3] <= 0))) {
            return false;
        }
        if (!clip.across || !clip.down) {
            return true;
        }
        const area: Rectangle = clip.rectangle;
        const radii: CornerRadii = clip.radii;
        const right: number = area.x + area.width;
        const bottom: number = area.y + area.height;
        const corners: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
            [area.x, area.y, radii[0], radii[1], area.x + radii[0], area.y + radii[1]],
            [right - radii[2], area.y, radii[2], radii[3], right - radii[2], area.y + radii[3]],
            [right - radii[4], bottom - radii[5], radii[4], radii[5], right - radii[4], bottom - radii[5]],
            [area.x, bottom - radii[7], radii[6], radii[7], area.x + radii[6], bottom - radii[7]]
        ];
        for (const [x, y, width, height, centerX, centerY] of corners) {
            if (width <= 0 || height <= 0 || kept[0] < x || kept[0] + kept[2] > x + width || kept[1] < y || kept[1] + kept[3] > y + height) {
                continue;
            }
            const nearX: number = Math.min(Math.max(centerX, kept[0]), kept[0] + kept[2]);
            const nearY: number = Math.min(Math.max(centerY, kept[1]), kept[1] + kept[3]);
            const distance: number = ((nearX - centerX) / width) ** 2 + ((nearY - centerY) / height) ** 2;
            return solid ? distance < 1 : distance <= 1;
        }
        return true;
    }

    private inRegion(ink: Box, region: ReadonlyArray<ReadonlyArray<readonly [SvgPath, boolean]>>, solid: boolean): boolean {
        // The meeting of the ink and a part, the intersection of its outlines by their fill rules (CSS Masking 1 §6.2), is a union of faces of the
        // arrangement of their edges, each bordered by a piece of an edge between two crossings, so it has area when a face beside a piece is in all.
        const [x, y, width, height]: Box = ink;
        const frame: Array<number> = [x, y, x + width, y, x + width, y, x + width, y + height, x + width, y + height, x, y + height, x, y + height, x, y];
        for (const part of region) {
            const outlines: ReadonlyArray<readonly [Array<number>, boolean]> = part.map((outline: readonly [SvgPath, boolean]): readonly [Array<number>, boolean] =>
                [this.geometry.edges(outline[0], PathGeometry.IDENTITY, REGION_FLATNESS), outline[1]]);
            const all: ReadonlyArray<number> = [...frame, ...outlines.flatMap((outline: readonly [Array<number>, boolean]) => outline[0])];
            for (let at: number = 0; at < all.length; at += 4) {
                const [x0, y0, x1, y1]: ReadonlyArray<number> = all.slice(at, at + 4);
                const length: number = Math.hypot(x1 - x0, y1 - y0);
                const cuts: Array<number> = [0, 1];
                for (let other: number = 0; other < all.length; other += 4) {
                    if (other !== at) {
                        cuts.push(...PagePainter.crossings(x0, y0, x1, y1, all[other], all[other + 1], all[other + 2], all[other + 3]));
                    }
                }
                cuts.sort((first: number, second: number) => first - second);
                for (let piece: number = 0; piece + 1 < cuts.length; piece++) {
                    const middle: number = (cuts[piece] + cuts[piece + 1]) / 2;
                    const mx: number = x0 + (x1 - x0) * middle;
                    const my: number = y0 + (y1 - y0) * middle;
                    if (!solid) {
                        // Ink without area, a line or a point, is seen where any point of it is in the closed region.
                        const points: ReadonlyArray<readonly [number, number]> = [[mx, my], [x0 + (x1 - x0) * cuts[piece], y0 + (y1 - y0) * cuts[piece]]];
                        if (at < frame.length && points.some((point: readonly [number, number]) =>
                            outlines.every((outline: readonly [Array<number>, boolean]) => PagePainter.closure(outline[0], outline[1], point[0], point[1])))) {
                            return true;
                        }
                        continue;
                    }
                    if (length === 0 || cuts[piece + 1] <= cuts[piece]) {
                        continue;
                    }
                    for (const side of [1, -1]) {
                        const dx: number = -(y1 - y0) / length * side;
                        const dy: number = (x1 - x0) / length * side;
                        if (PagePainter.besides(frame, false, mx, my, dx, dy)
                            && outlines.every((outline: readonly [Array<number>, boolean]) => PagePainter.besides(outline[0], outline[1], mx, my, dx, dy))) {
                            return true;
                        }
                    }
                }
            }
        }
        return false;
    }

    private static besides(edges: ReadonlyArray<number>, evenOdd: boolean, px: number, py: number, dx: number, dy: number): boolean {
        // Whether the face next to a point on the side of a direction is inside: a ray from the point that way crosses the edges as a ray from
        // that face does, the edges through the point aside, which are behind it.
        let crossings: number = 0;
        let winding: number = 0;
        for (let at: number = 0; at < edges.length; at += 4) {
            const ax: number = edges[at] - px;
            const ay: number = edges[at + 1] - py;
            const bx: number = edges[at + 2] - px;
            const by: number = edges[at + 3] - py;
            if (ax * by - ay * bx === 0 && ax * bx + ay * by <= 0) {
                continue;
            }
            const y0: number = -ax * dy + ay * dx;
            const y1: number = -bx * dy + by * dx;
            if ((y0 <= 0) !== (y1 <= 0)) {
                const x0: number = ax * dx + ay * dy;
                const x1: number = bx * dx + by * dy;
                if (x0 - y0 * (x1 - x0) / (y1 - y0) > 0) {
                    crossings++;
                    winding += y1 > y0 ? 1 : -1;
                }
            }
        }
        return evenOdd ? crossings % 2 === 1 : winding !== 0;
    }

    private static closure(edges: ReadonlyArray<number>, evenOdd: boolean, px: number, py: number): boolean {
        // A point is in the closed region when it is inside, or on an edge with an inside face beside it.
        let on: boolean = false;
        for (let at: number = 0; at < edges.length; at += 4) {
            const ax: number = edges[at] - px;
            const ay: number = edges[at + 1] - py;
            const bx: number = edges[at + 2] - px;
            const by: number = edges[at + 3] - py;
            if (ax * by - ay * bx !== 0 || ax * bx + ay * by > 0) {
                continue;
            }
            on = true;
            const length: number = Math.hypot(bx - ax, by - ay);
            if (length > 0 && (PagePainter.besides(edges, evenOdd, px, py, -(by - ay) / length, (bx - ax) / length)
                || PagePainter.besides(edges, evenOdd, px, py, (by - ay) / length, -(bx - ax) / length))) {
                return true;
            }
        }
        return !on && PagePainter.besides(edges, evenOdd, px, py, 1, 0);
    }

    private static crossings(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): Array<number> {
        // Where along the first edge the second one meets it: the point where they cross, or the ends of the second one on the first where
        // they lie on one line.
        const dx: number = x1 - x0;
        const dy: number = y1 - y0;
        const ex: number = x3 - x2;
        const ey: number = y3 - y2;
        const denominator: number = dx * ey - dy * ex;
        const squared: number = dx * dx + dy * dy;
        if (denominator === 0) {
            if (squared === 0 || (x2 - x0) * dy - (y2 - y0) * dx !== 0) {
                return [];
            }
            return [((x2 - x0) * dx + (y2 - y0) * dy) / squared, ((x3 - x0) * dx + (y3 - y0) * dy) / squared].filter((t: number) => t > 0 && t < 1);
        }
        const t: number = ((x2 - x0) * ey - (y2 - y0) * ex) / denominator;
        const u: number = ((x2 - x0) * dy - (y2 - y0) * dx) / denominator;
        return t > 0 && t < 1 && u >= 0 && u <= 1 ? [t] : [];
    }

    private static area(box: Box): ClipArea {
        return { rectangle: { x: box[0], y: box[1], width: box[2], height: box[3] }, radii: NO_RADII, across: true, down: true };
    }

    private projectedBox(box: Box, matrix: Matrix4): Box | undefined {
        // CSS Transforms 1 §10: a box whose transform is not invertible is not displayed, and otherwise it covers what its corners go to.
        const homography: Homography = this.geometry.homography(matrix);
        if (this.geometry.invertHomography(homography) === undefined) {
            return undefined;
        }
        let result: Box | undefined;
        for (const [x, y] of [[box[0], box[1]], [box[0] + box[2], box[1]], [box[0], box[1] + box[3]], [box[0] + box[2], box[1] + box[3]]]) {
            const point: readonly [number, number] | undefined = this.geometry.project(homography, x, y);
            if (point !== undefined) {
                result = this.geometry.union(result, [point[0], point[1], 0, 0]);
            }
        }
        return result;
    }

    private decorated(decorators: ReadonlyArray<ComputedStyle>, style: ComputedStyle): ReadonlyArray<ComputedStyle> {
        const line: CssValue | undefined = style.values["text-decoration-line"];
        return line === undefined || (line.kind === "ident" && line.lower === "none") ? decorators : [...decorators, style];
    }

    private collect(fragment: BoxFragment, transform: Transform, frame: number, layers: Array<Layer>, top: boolean, held: ReadonlyArray<Held>, view: Matrix4 | undefined, host: ElementBox | undefined,
        decorators: ReadonlyArray<ComputedStyle> = []): void {
        if (this.veiled(fragment)) {
            if (!top && this.isLayered(fragment.box)) {
                this.veiledMarks(fragment, transform, frame, view, true);
            }
            return;
        }
        // CSS Overflow 3 §3: a clip holds the boxes whose containing block it contains, so it holds an absolutely positioned box only when
        // a box that contains absolute ones comes between them, and a fixed box only when one that contains fixed ones does.
        let passed: ReadonlyArray<Held> = held;
        const positioned: boolean = this.isPositioned(fragment.box);
        const containing: boolean = this.containsFixed(fragment.box);
        if (!top) {
            // Compositing 1 §3.1: a box with effects that group it is a stacking context painted as if positioned with z-index 0.
            const grouped: boolean = this.stacks(fragment.box);
            const z: number | undefined = positioned ? this.zIndex(fragment.box) : undefined;
            if (positioned || grouped) {
                const position: string = this.keyword(fragment.box.style.values["position"]);
                const clips: Array<Clip> = held.filter((entry: Held) => position === "absolute" ? entry.positioned : position !== "fixed" || entry.fixed)
                    .map((entry: Held) => entry.clip);
                const layer: Layer = this.layer(fragment, transform, frame, z ?? 0, z !== undefined || grouped, clips, view, host);
                if (held.length > 0) {
                    layer.held = held;
                }
                layers.push(layer);
            }
            if (z !== undefined || grouped) {
                return;
            }
        }
        const holds: boolean = positioned || containing || this.displays.changesContaining(fragment.box.style.values, fragment.box.display, fragment.box.replaced, false);
        if (holds) {
            passed = held.map((entry: Held): Held => ({ clip: entry.clip, positioned: true, fixed: entry.fixed || containing }));
        }
        const clip: Clip | undefined = this.clipOf(fragment, transform);
        if (clip !== undefined) {
            passed = [...passed, { clip, positioned: holds, fixed: containing }];
        }
        const inner: Transform = this.sizes.compose(transform, this.sizes.inside(fragment, frame));
        const own: number = this.sizes.frame(fragment.box.style);
        // The perspective of a box reaches its element children, through the anonymous boxes between.
        const named: boolean = this.named(fragment);
        const eye: Matrix4 | undefined = named ? this.eye(fragment, transform) : view;
        const next: ElementBox | undefined = named ? fragment.box : host;
        // CSS Text Decoration 4 §2: the decorations of a block reach the text of its lines, in-flow inline boxes with layers of their own included.
        const decorating: ReadonlyArray<ComputedStyle> = this.decorated(decorators, fragment.box.style);
        for (const child of fragment.children ?? []) {
            if (child.kind === "box") {
                this.collect(child, inner, own, layers, false, passed, eye, next, this.carries(child.box) ? decorating : []);
                continue;
            }
            const line: Transform = this.lineTransform(inner, child);
            for (const piece of child.pieces) {
                if (piece.kind !== "box") {
                    continue;
                }
                const at: number = layers.length;
                this.collect(piece, line, own, layers, false, passed, eye, next);
                const layer: Layer | undefined = layers[at];
                if (layer !== undefined && layer.fragment === piece && !piece.box.replaced && this.displays.isInlineBox(piece.box.display)) {
                    layer.line = { line: child, transform: inner, decorators: decorating };
                }
            }
        }
    }

    private blocks(fragment: BoxFragment, transform: Transform, frame: number, pdf: PdfPage): void {
        for (const child of fragment.children ?? []) {
            if (child.kind !== "box" || this.isLayered(child.box) || child.box.placement === "float") {
                continue;
            }
            if (this.veiled(child)) {
                this.veiledMarks(child, transform, frame, undefined, true);
                continue;
            }
            this.box(child, transform, frame, pdf, false);
            const clipped: boolean = this.clip(child, transform, pdf);
            this.blocks(child, this.sizes.compose(transform, this.sizes.inside(child, frame)), this.sizes.frame(child.box.style), pdf);
            if (clipped) {
                pdf.content.restore();
            }
        }
    }

    private floats(fragment: BoxFragment, transform: Transform, frame: number, pdf: PdfPage): void {
        for (const child of fragment.children ?? []) {
            if (child.kind !== "box" || this.isLayered(child.box)) {
                continue;
            }
            if (this.veiled(child)) {
                if (child.box.placement === "float") {
                    this.veiledMarks(child, transform, frame, undefined, true);
                }
                continue;
            }
            if (child.box.placement === "float") {
                this.atomically({ fragment: child, transform, frame, z: 0, context: false, clips: [] }, pdf);
            } else {
                const clipped: boolean = this.clip(child, transform, pdf);
                this.floats(child, this.sizes.compose(transform, this.sizes.inside(child, frame)), this.sizes.frame(child.box.style), pdf);
                if (clipped) {
                    pdf.content.restore();
                }
            }
        }
    }

    private inlines(fragment: BoxFragment, transform: Transform, frame: number, pdf: PdfPage, decorators: ReadonlyArray<ComputedStyle>): void {
        // CSS Text Decoration 4 §2: decorations go on to the in-flow block-level children. What a box draws of its own, as math layout does,
        // is content of the box, painted with its inline content.
        if (this.drawing !== undefined && !HIDDEN.has(this.keyword(fragment.box.style.values["visibility"]))) {
            this.drawing.paint(fragment, transform, pdf);
        }
        for (const child of fragment.children ?? []) {
            if (child.kind === "line") {
                this.line(child, transform, frame, pdf, decorators);
            } else if (this.veiled(child)) {
                continue;
            } else if (child.box.replaced && !this.isLayered(child.box) && child.box.placement !== "float") {
                // CSS 2 Appendix E.2: "If the element is a block-level replaced element, then: the replaced content".
                this.replaced(child, transform, frame, pdf);
            } else if (!this.isLayered(child.box) && child.box.placement !== "float") {
                const clipped: boolean = this.clip(child, transform, pdf);
                this.inlines(child, this.sizes.compose(transform, this.sizes.inside(child, frame)), this.sizes.frame(child.box.style), pdf,
                    this.decorated(decorators, child.box.style));
                if (clipped) {
                    pdf.content.restore();
                }
            }
        }
    }

    private line(line: LineFragment, transform: Transform, frame: number, pdf: PdfPage, decorators: ReadonlyArray<ComputedStyle>): void {
        // CSS 2 Appendix E.2: the boxes and the runs of text of a line in tree order, but for what an inline box with a layer of its own holds.
        const owners: Map<TextPiece | BoxFragment, BoxFragment> = this.owners(line);
        this.linePieces(line, owners.size === 0 ? line.pieces : line.pieces.filter((piece: TextPiece | BoxFragment) => !owners.has(piece)), transform, frame, pdf, decorators);
    }

    private owners(line: LineFragment): Map<TextPiece | BoxFragment, BoxFragment> {
        // The pieces of a line that an inline box painted from its own layer holds, each by the innermost one: the fragment of an inline box comes
        // before its contents in the line, and they lie within its extent along it.
        const owners: Map<TextPiece | BoxFragment, BoxFragment> = new Map<TextPiece | BoxFragment, BoxFragment>();
        const layered: Array<BoxFragment> = [];
        for (const piece of line.pieces) {
            let owner: BoxFragment | undefined;
            for (const candidate of layered) {
                if (piece.inline >= candidate.inline - PIECE_TOLERANCE && piece.inline + piece.inlineSize <= candidate.inline + candidate.inlineSize + PIECE_TOLERANCE
                    && (owner === undefined || candidate.inlineSize <= owner.inlineSize)) {
                    owner = candidate;
                }
            }
            if (owner !== undefined) {
                owners.set(piece, owner);
            }
            if (piece.kind === "box" && !piece.box.replaced && this.displays.isInlineBox(piece.box.display) && this.isLayered(piece.box)) {
                layered.push(piece);
            }
        }
        return owners;
    }

    private linePieces(line: LineFragment, pieces: ReadonlyArray<TextPiece | BoxFragment>, transform: Transform, frame: number, pdf: PdfPage,
        decorators: ReadonlyArray<ComputedStyle>): void {
        // CSS Text Decoration 4 §5.1: line-throughs go over all the text painted.
        const local: Transform = this.lineTransform(transform, line);
        const texts: ReadonlyArray<TextPiece> = line.pieces.filter((piece: TextPiece | BoxFragment): piece is TextPiece => piece.kind === "text");
        const shown: ReadonlyArray<TextPiece> = pieces.filter((piece: TextPiece | BoxFragment): piece is TextPiece => piece.kind === "text");
        let runs: Array<TextPiece> = [];
        for (const piece of pieces) {
            if (piece.kind === "text") {
                runs.push(piece);
            } else if (!this.isLayered(piece.box) && this.veiled(piece)) {
                this.veiledMarks(piece, local, frame, undefined, true);
            } else if (!this.isLayered(piece.box)) {
                this.text.runs(line, texts, runs, transform, decorators, pdf);
                runs = [];
                if (!piece.box.replaced && this.displays.isInlineBox(piece.box.display)) {
                    this.box(piece, local, frame, pdf, false);
                } else {
                    this.atomically({ fragment: piece, transform: local, frame, z: 0, context: false, clips: [] }, pdf);
                }
            }
        }
        this.text.runs(line, texts, runs, transform, decorators, pdf);
        this.text.decorate(line, texts, shown, transform, decorators, pdf, true);
    }

    private lineTransform(transform: Transform, line: LineFragment): Transform {
        return this.sizes.compose(transform, [1, 0, 0, 1, line.inline ?? 0, line.block]);
    }

    private box(fragment: BoxFragment, transform: Transform, frame: number, pdf: PdfPage, root: boolean): void {
        const box: ElementBox = fragment.box;
        const style: ComputedStyle = box.style;
        if (box.placement === "running" || box.placement === "footnote" || box.placement === "page-float") {
            return;
        }
        this.supported(fragment);
        const area: readonly [number, number, number, number] = this.sizes.mapped(transform, fragment.inline, fragment.block, fragment.inlineSize, fragment.blockSize);
        const rectangle: Rectangle = { x: area[0], y: area[1], width: area[2], height: area[3] };
        const hidden: boolean = HIDDEN.has(this.keyword(style.values["visibility"]));
        this.anchor(fragment, rectangle, hidden);
        // An empty fragment that continues a box, as the overflow-only fragment of CSS Fragmentation 4 §5.5, has no area to paint.
        if (hidden || (fragment.resumed === true && fragment.inlineSize === 0 && fragment.blockSize === 0)) {
            return;
        }
        const own: number = this.sizes.frame(style);
        const styles: Array<string> = ["none", "none", "none", "none"];
        const colors: Array<CssValue | undefined> = [undefined, undefined, undefined, undefined];
        for (let side: number = 0; side < 4; side++) {
            const physical: number = this.sizes.physicalSide(own, side);
            styles[physical] = this.keyword(style.values["border-" + SIDE_NAMES[side] + "-style"]);
            colors[physical] = style.values["border-" + SIDE_NAMES[side] + "-color"];
        }
        // CSS Fragmentation 4 §5.4: with slice the backgrounds, border-radius and borders are those of the whole box "as if it were unbroken", and each
        // fragment shows its slice of them.
        const whole: WholeGeometry | undefined = this.wholeGeometry(fragment, transform);
        const shape: Rectangle = whole?.area ?? rectangle;
        const [borders, padding]: readonly [PhysicalSides, PhysicalSides] = whole === undefined ? this.edges(fragment) : [whole.border, whole.padding];
        const radii: CornerRadii = this.radii(style, shape);
        if (whole !== undefined) {
            pdf.content.save();
            pdf.content.rectangle(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
            pdf.content.clip(false);
        }
        if (!root) {
            const shapes: (form: PdfPage, text: boolean, border: boolean) => void = (form: PdfPage, text: boolean, border: boolean): void => {
                if (border) {
                    this.borders.paint(shape, borders, styles, OPAQUE_SIDES, style, form, radii);
                }
                if (text) {
                    this.textShapes(fragment, transform, frame, form);
                }
            };
            // CSS Transforms 1 §3: in a transformed box "a value of fixed for the background-attachment property is treated as
            // if it had a value of scroll".
            const place: BackgroundPlace = this.moved ? { base: this.base, shapes } : { base: this.base, page: this.page, shapes };
            if (whole !== undefined) {
                place.sizing = whole.sizing;
            }
            this.backgrounds.paint(shape, borders, padding, style, pdf, undefined, radii, place);
        }
        if (fragment.collapsed !== undefined) {
            this.collapsed(fragment.collapsed, rectangle, own, pdf);
        } else if (!(box.display.inner === "table" && box.display.internal === undefined && this.keyword(style.values["border-collapse"]) === "collapse")) {
            // CSS 2 §17.6.2: in the collapsing model the borders of the table are those of its cells at its edges.
            this.borders.paint(shape, borders, styles, colors, style, pdf, radii);
        }
        if (whole !== undefined) {
            pdf.content.restore();
        }
        if (fragment.rules !== undefined) {
            this.columnRules(fragment, transform, frame, pdf);
        }
    }

    private columnRules(fragment: BoxFragment, transform: Transform, frame: number, pdf: PdfPage): void {
        // CSS Multicol 1 §4: a column rule is drawn in the middle of the gap between two columns that have content, and it takes
        // the width, style and color that a border does.
        const style: ComputedStyle = fragment.box.style;
        const line: string = this.keyword(style.values["column-rule-style"]);
        const given: CssValue | undefined = style.values["column-rule-width"];
        const width: number = given === undefined ? 3 : (given.kind === "ident" ? (RULE_WIDTHS.get(given.lower) ?? 3) : this.sizes.pixels(given, 0));
        if (line === "none" || line === "hidden" || width <= 0) {
            return;
        }
        const named: CssValue | undefined = style.values["column-rule-color"];
        const color: CssValue | undefined = named === undefined || (named.kind === "ident" && named.lower === "currentcolor") ? style.values["color"] : named;
        const inner: Transform = this.sizes.compose(transform, this.sizes.inside(fragment, frame));
        const vertical: boolean = (this.sizes.frame(style) & BoxSizes.VERTICAL) !== 0;
        for (const [inline, block, extent] of fragment.rules ?? []) {
            const area: readonly [number, number, number, number] = this.sizes.mapped(inner, inline - width / 2, block, width, extent);
            const widths: PhysicalSides = vertical ? [width, 0, 0, 0] : [0, 0, 0, width];
            const styles: ReadonlyArray<string> = vertical ? [line, "none", "none", "none"] : ["none", "none", "none", line];
            this.borders.paint({ x: area[0], y: area[1], width: area[2], height: area[3] }, widths, styles, [color, color, color, color], style, pdf);
        }
    }

    private textShapes(fragment: BoxFragment, transform: Transform, frame: number, form: PdfPage): void {
        // CSS Backgrounds 4 §2.8: the text "in the element and its in-flow and floated descendants", with their decorations.
        const walk: (box: BoxFragment, outer: Transform, frame: number, decorators: ReadonlyArray<ComputedStyle>) => void =
            (box: BoxFragment, outer: Transform, frame: number, decorators: ReadonlyArray<ComputedStyle>): void => {
                const inner: Transform = this.sizes.compose(outer, this.sizes.inside(box, frame));
                const own: number = this.sizes.frame(box.box.style);
                const decorating: ReadonlyArray<ComputedStyle> = this.decorated(decorators, box.box.style);
                if (this.drawing !== undefined && !HIDDEN.has(this.keyword(box.box.style.values["visibility"]))) {
                    this.drawing.shapes(box, inner, form);
                }
                for (const child of box.children ?? []) {
                    if (child.kind === "box") {
                        if (!this.isLayered(child.box) && !child.box.replaced && !this.veiled(child)) {
                            walk(child, inner, own, decorating);
                        }
                        continue;
                    }
                    const local: Transform = this.lineTransform(inner, child);
                    for (const piece of child.pieces) {
                        if (piece.kind === "text") {
                            this.text.shapes(child, piece, inner, decorating, form);
                        } else if (!this.isLayered(piece.box) && !piece.box.replaced && !this.displays.isInlineBox(piece.box.display) && !this.veiled(piece)) {
                            walk(piece, local, own, []);
                        }
                    }
                }
            };
        walk(fragment, transform, frame, []);
    }

    private anchor(fragment: BoxFragment, rectangle: Rectangle, hidden: boolean): void {
        const page: PdfPage | undefined = this.annotated;
        const box: ElementBox = fragment.box;
        const names: ReadonlyArray<string> | undefined = fragment.resumed === true ? undefined : this.setup.references.destinations(box);
        const shown: Rectangle | undefined = this.placed(rectangle);
        if (shown === undefined) {
            return;
        }
        if (page === undefined) {
            // The links and the destinations of a formula are areas and points of its image, which the page it is drawn on takes from it.
            const collected: Collected | undefined = this.collected;
            const target: string | undefined = box.linkDestination ?? box.linkUri;
            if (collected === undefined) {
                return;
            }
            for (const name of names ?? []) {
                collected.destinations.push([name, shown.x, shown.y]);
            }
            if (!hidden && shown.width > 0 && shown.height > 0 && target !== undefined) {
                collected.links.push([{ x: shown.x, y: shown.y, width: shown.width, height: shown.height }, target, box.linkDestination !== undefined]);
            }
            return;
        }
        for (const name of names ?? []) {
            this.document.addDestination(name, page, shown.x * POINTS_PER_PIXEL, shown.y * POINTS_PER_PIXEL);
        }
        if (hidden || shown.width <= 0 || shown.height <= 0 || (box.linkDestination === undefined && box.linkUri === undefined)) {
            return;
        }
        const area: PageRectangle = {
            x: shown.x * POINTS_PER_PIXEL, y: shown.y * POINTS_PER_PIXEL, width: shown.width * POINTS_PER_PIXEL, height: shown.height * POINTS_PER_PIXEL
        };
        if (box.linkDestination !== undefined) {
            this.document.linkToDestination(page, area, box.linkDestination);
        } else if (box.linkUri !== undefined) {
            this.document.linkToUri(page, area, box.linkUri);
        }
    }

    private placed(rectangle: Rectangle): Rectangle | undefined {
        // Where a rectangle of the local plane lies on the page: the box of what its corners go to under the transforms in force,
        // which is nothing for a plane that is not seen.
        if (this.lens === undefined) {
            return rectangle;
        }
        let box: Box | undefined;
        const outline: SvgPath = this.geometry.rectangle(rectangle.x, rectangle.y, rectangle.width, rectangle.height, 0, 0);
        for (const polygon of this.geometry.projected(outline, this.lens, 1)) {
            for (const point of polygon) {
                box = this.geometry.union(box, [point[0], point[1], 0, 0]);
            }
        }
        return box === undefined ? undefined : { x: box[0], y: box[1], width: box[2], height: box[3] };
    }

    private linked(marks: ImageMarks): void {
        // The links and the destinations inside an image, such as those of a formula, are areas and points of the page where the image is drawn.
        const page: PdfPage | undefined = this.annotated;
        for (const [name, x, y] of marks.destinations) {
            const shown: Rectangle | undefined = this.placed({ x, y, width: 0, height: 0 });
            if (shown === undefined) {
                continue;
            }
            if (page === undefined) {
                this.collected?.destinations.push([name, shown.x, shown.y]);
            } else {
                this.document.addDestination(name, page, shown.x * POINTS_PER_PIXEL, shown.y * POINTS_PER_PIXEL);
            }
        }
        for (const [rectangle, name, internal] of marks.links) {
            const shown: Rectangle | undefined = this.placed({ x: rectangle.x, y: rectangle.y, width: rectangle.width, height: rectangle.height });
            if (shown === undefined) {
                continue;
            }
            if (page === undefined) {
                this.collected?.links.push([{ x: shown.x, y: shown.y, width: shown.width, height: shown.height }, name, internal]);
                continue;
            }
            const area: PageRectangle = {
                x: shown.x * POINTS_PER_PIXEL, y: shown.y * POINTS_PER_PIXEL, width: shown.width * POINTS_PER_PIXEL, height: shown.height * POINTS_PER_PIXEL
            };
            if (internal) {
                this.document.linkToDestination(page, area, name);
            } else {
                this.document.linkToUri(page, area, name);
            }
        }
    }

    private edges(fragment: BoxFragment): readonly [PhysicalSides, PhysicalSides] {
        // The sides of a fragment are those of its own writing mode, whatever the frame of its container.
        const own: number = this.sizes.frame(fragment.box.style);
        const borders: [number, number, number, number] = [0, 0, 0, 0];
        const padding: [number, number, number, number] = [0, 0, 0, 0];
        for (let side: number = 0; side < 4; side++) {
            const physical: number = this.sizes.physicalSide(own, side);
            borders[physical] = fragment.border === undefined ? 0 : fragment.border[side];
            padding[physical] = fragment.padding === undefined ? 0 : fragment.padding[side];
        }
        return [borders, padding];
    }

    private collapsed(edges: CollapsedBorders, rectangle: Rectangle, frame: number, pdf: PdfPage): void {
        // CSS 2 §17.6.2: "Borders are centered on the grid lines between the cells", each with the width, style and color of
        // the border that won the conflict; a cell paints the lines before it, and those after it at the end of the grid.
        const sources: ReadonlyArray<EdgeSource | undefined> = [edges.blockStart, edges.inlineEnd, edges.blockEnd, edges.inlineStart];
        const physical: Array<EdgeSource | undefined> = [undefined, undefined, undefined, undefined];
        for (let side: number = 0; side < 4; side++) {
            physical[this.sizes.physicalSide(frame, side)] = sources[side];
        }
        const width: (source?: EdgeSource) => number = (source?: EdgeSource): number => source === undefined ? 0 : this.sizes.border(source[0].style, source[1]);
        const painted: ReadonlyArray<boolean> = [true, edges.lastInline === true, edges.lastBlock === true, true];
        const owned: Array<boolean> = [false, false, false, false];
        for (let side: number = 0; side < 4; side++) {
            owned[this.sizes.physicalSide(frame, side)] = painted[side];
        }
        const right: number = rectangle.x + rectangle.width;
        const bottom: number = rectangle.y + rectangle.height;
        for (let side: number = 0; side < 4; side++) {
            const source: EdgeSource | undefined = physical[side];
            const size: number = width(source);
            if (source === undefined || size <= 0 || !owned[side]) {
                continue;
            }
            // The line runs past the corners by half the width of the lines that cross it, so that the corners are covered.
            const across: boolean = side === 0 || side === 2;
            const before: number = width(physical[across ? 3 : 0]) / 2;
            const after: number = width(physical[across ? 1 : 2]) / 2;
            const line: number = side === 0 ? rectangle.y : (side === 1 ? right : (side === 2 ? bottom : rectangle.x));
            const band: Rectangle = across ? { x: rectangle.x - before, y: line - size / 2, width: rectangle.width + before + after, height: size }
                : { x: line - size / 2, y: rectangle.y - before, width: size, height: rectangle.height + before + after };
            const widths: [number, number, number, number] = [0, 0, 0, 0];
            widths[side] = size;
            const lineStyle: string = this.sizes.borderStyle(source[0].style, source[1]);
            // CSS Backgrounds 3 §3.2: inset is "Treated as ridge in the collapsing border model", and outset as groove.
            const shown: string = lineStyle === "inset" ? "ridge" : (lineStyle === "outset" ? "groove" : lineStyle);
            const styles: Array<string> = ["none", "none", "none", "none"];
            styles[side] = shown;
            const colors: Array<CssValue | undefined> = [undefined, undefined, undefined, undefined];
            colors[side] = source[0].style.values["border-" + SIDE_NAMES[source[1]] + "-color"];
            this.borders.paint(band, widths, styles, colors, source[0].style, pdf);
        }
    }

    private radii(style: ComputedStyle, rectangle: Rectangle): CornerRadii {
        // CSS Backgrounds 3 §4.5: when the curves of a side would overlap, all radii are scaled down alike.
        const radii: Array<number> = [];
        for (const property of RADII) {
            const value: CssValue | undefined = style.values[property];
            const items: ReadonlyArray<CssValue> = value === undefined ? [] : (value.kind === "list" ? value.items : [value]);
            const first: CssValue | undefined = items[0];
            const second: CssValue | undefined = items[1] ?? first;
            radii.push(first === undefined ? 0 : Math.max(0, this.sizes.pixels(first, rectangle.width)), second === undefined ? 0 : Math.max(0, this.sizes.pixels(second, rectangle.height)));
        }
        const sums: ReadonlyArray<readonly [number, number]> = [
            [radii[0] + radii[2], rectangle.width], [radii[3] + radii[5], rectangle.height], [radii[4] + radii[6], rectangle.width], [radii[1] + radii[7], rectangle.height]
        ];
        let factor: number = 1;
        for (const [sum, length] of sums) {
            factor = sum > 0 ? Math.min(factor, length / sum) : factor;
        }
        return [radii[0] * factor, radii[1] * factor, radii[2] * factor, radii[3] * factor, radii[4] * factor, radii[5] * factor, radii[6] * factor, radii[7] * factor];
    }

    private supported(fragment: BoxFragment): void {
        const values: Readonly<Record<string, CssValue>> = fragment.box.style.values;
        for (const property of UNPAINTED) {
            if (!PagePainter.isNone(values[property])) {
                throw new Error("The painting of " + property + " is not implemented");
            }
        }
    }

    private containsFixed(box: ElementBox): boolean {
        // CSS Transforms 1 §3, CSS Containment 2 §3.2 and §3.4: a transform and layout or paint containment make the containing block of the fixed
        // boxes inside, and Filter Effects 1 §5 a filter on any box "unless the element it applies to is a document root element".
        const contained: number = this.displays.containment(box.style.values, box.display, box.replaced) & (DisplayTypes.LAYOUT_CONTAINMENT | DisplayTypes.PAINT_CONTAINMENT);
        const root: boolean = box.element !== undefined && box.pseudoElement === undefined && box.element.getParent() === undefined;
        return contained !== 0 || (this.displays.isTransformable(box.display, box.replaced) && this.displays.isTransforming(box.style.values, root))
            || (!root && this.displays.isFiltering(box.style.values)) || this.displays.changesContaining(box.style.values, box.display, box.replaced, true, root);
    }

    private isPositioned(box: ElementBox): boolean {
        const position: string = this.keyword(box.style.values["position"]);
        return position !== "none" && position !== "static";
    }

    private isLayered(box: ElementBox): boolean {
        // A box that is painted from its own layer: a positioned one, or one that makes a stacking context by its effects.
        return this.isPositioned(box) || this.stacks(box);
    }

    private stacks(box: ElementBox): boolean {
        // Compositing 1 §3.1 and CSS Transforms 1 §3: effects that group the box, or a transform of a transformable box; CSS Masking 1 §5.1, §7.1, §8.1:
        // clip-path, mask-image, mask-border-source; CSS Containment 2 §3.2 and §3.4: layout and paint containment; CSS Will Change 1 §2: a property named.
        const values: Readonly<Record<string, CssValue>> = box.style.values;
        return this.grouping(box.style) !== undefined || ["clip-path", "mask-image", "mask-border-source"].some((property: string) => !PagePainter.isNone(values[property]))
            || (this.displays.isTransformable(box.display, box.replaced) && this.displays.isTransforming(values))
            || (this.displays.containment(values, box.display, box.replaced) & (DisplayTypes.LAYOUT_CONTAINMENT | DisplayTypes.PAINT_CONTAINMENT)) !== 0
            || this.displays.changesStacking(values, box.display, box.replaced, this.isPositioned(box));
    }

    private grouping(style: ComputedStyle): Grouping | undefined {
        // Compositing 1 §3.1 and CSS Color 4 §3.2: opacity below 1, a blend mode other than normal and isolation make a stacking
        // context whose contents are one group, composited as a whole with its alpha and blend mode.
        const values: Readonly<Record<string, CssValue>> = style.values;
        const opacity: CssValue | undefined = values["opacity"];
        const alpha: number = opacity === undefined ? 1 : (opacity.kind === "number" ? opacity.value : (opacity.kind === "percentage" ? opacity.value / 100 : 1));
        const blend: string = BackgroundPainter.BLEND_MODES.get(this.keyword(values["mix-blend-mode"])) ?? "Normal";
        const isolated: boolean = this.keyword(values["isolation"]) === "isolate";
        return alpha < 1 || blend !== "Normal" || isolated ? { alpha: Math.min(1, Math.max(0, alpha)), blend } : undefined;
    }

    private zIndex(box: ElementBox): number | undefined {
        // CSS 2 §9.9.1: a positioned box with an integer z-index establishes a stacking context, and with auto it does not; CSS Position 3 §2:
        // "Fixed and sticky positioned boxes nonetheless form a stacking context", at level 0.
        const value: CssValue | undefined = box.style.values["z-index"];
        if (value !== undefined && value.kind === "number") {
            return value.value;
        }
        const position: string = this.keyword(box.style.values["position"]);
        return position === "fixed" || position === "sticky" ? 0 : undefined;
    }

    private static isNone(value?: CssValue): boolean {
        if (value === undefined) {
            return true;
        }
        const items: ReadonlyArray<CssValue> = value.kind === "list" ? value.items : [value];
        return items.every((item: CssValue) => item.kind === "ident" && item.lower === "none");
    }

    private keyword(value?: CssValue): string {
        return value !== undefined && value.kind === "ident" ? value.lower : "none";
    }
}
