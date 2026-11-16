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
import type { BoxFragment, CollapsedBorders, EdgeSource, LineFragment, TextPiece } from "../layout/Fragment.js";
import type { MarginForms, PageLayout } from "../pages/PageDriver.js";
import type { PageSetup } from "../PdfGenerator.js";
import type { ElementBox } from "../pdf/BoxTree.js";
import type { ComputedStyle } from "../pdf/ComputedStyle.js";
import { DisplayTypes } from "../pdf/DisplayTypes.js";
import type { PageCanvas, Rectangle } from "../pdf/PageCanvas.js";
import { SvgGeometry } from "../svg/SvgGeometry.js";
import type { Matrix4, SvgPath } from "../svg/SvgGeometry.js";
import type { PdfDocument } from "../writer/PdfDocument.js";
import type { ImageResource, PageRectangle, PdfPage } from "../writer/PdfPage.js";
import { BackgroundPainter } from "./BackgroundPainter.js";
import type { CornerRadii, PhysicalSides } from "./BorderPainter.js";
import { BorderPainter } from "./BorderPainter.js";
import type { ColorOutput } from "./ColorOutput.js";
import { ImagePainter } from "./ImagePainter.js";
import { TextPainter } from "./TextPainter.js";

interface Clip {
    rectangle: Rectangle;
    radii: CornerRadii;
}

interface Held {
    clip: Clip;
    positioned: boolean;
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
const HIDDEN: ReadonlySet<string> = new Set<string>(["hidden", "collapse"]);
const NONE_PROPERTIES: ReadonlyArray<string> = ["transform", "translate", "rotate", "scale", "filter", "backdrop-filter", "clip-path", "mask-image", "box-shadow-offset",
    "outline-style", "border-image-source"];
const NOT_PAINTED: ReadonlySet<string> = new Set<string>();
const PAINTED_EFFECTS: ReadonlySet<string> = new Set<string>(["opacity", "mix-blend-mode", "transform", "translate", "rotate", "scale"]);
const OWN_TRANSFORMS: ReadonlyArray<string> = ["transform", "translate", "rotate", "scale"];
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
            const whole: readonly [Rectangle, PhysicalSides, PhysicalSides] = this.rootArea(page);
            this.backgrounds.paint(this.moved ? this.reach : canvas.borderBox, pageBorders, pagePadding, this.setup.root, target, undefined, NO_RADII,
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
        // GCPM 3 §2.4.1: the footnote area is placed in the page area, in the same coordinates as the content.
        for (const fragment of [page.content, page.footnotes]) {
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
        if (forms.below !== undefined) {
            this.form(layers.filter((candidate: Layer) => candidate.z < 0), forms.below, document);
        }
        this.form(layers.filter((candidate: Layer) => forms.below === undefined || candidate.z >= 0), forms.above, document);
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
        // CSS Transforms 2 §4.1.1: the perspective of the parent, then the element's own transform about its origin.
        const values: Readonly<Record<string, CssValue>> = fragment.box.style.values;
        if (OWN_TRANSFORMS.every((property: string) => PagePainter.isNone(values[property])) || !this.displays.isTransformable(fragment.box.display, fragment.box.replaced)) {
            return undefined;
        }
        const own: Matrix4 = this.geometry.spatial(values, this.reference(fragment, transform));
        return view === undefined ? own : this.geometry.multiply4(view, own);
    }

    private eye(fragment: BoxFragment, transform: Transform): Matrix4 | undefined {
        // CSS Transforms 2 §12: the perspective of a box applies to the transforms of its children, about its perspective-origin.
        const values: Readonly<Record<string, CssValue>> = fragment.box.style.values;
        const distance: CssValue | undefined = values["perspective"];
        if (PagePainter.isNone(distance) || !this.displays.isTransformable(fragment.box.display, fragment.box.replaced)) {
            return undefined;
        }
        return this.geometry.perspectiveOf(this.sizes.pixels(distance as CssValue, 0), values, this.reference(fragment, transform));
    }

    private reference(fragment: BoxFragment, transform: Transform): Box {
        // CSS Transforms 1 §6: for a box of the CSS box model fill-box is the content box, and stroke-box and view-box are
        // the border box.
        const area: readonly [number, number, number, number] = this.sizes.mapped(transform, fragment.inline, fragment.block, fragment.inlineSize, fragment.blockSize);
        const keyword: string = this.keyword(fragment.box.style.values["transform-box"]);
        if (keyword !== "content-box" && keyword !== "fill-box") {
            return [area[0], area[1], area[2], area[3]];
        }
        const [borders, padding]: readonly [PhysicalSides, PhysicalSides] = this.edges(fragment);
        const top: number = borders[0] + padding[0];
        const right: number = borders[1] + padding[1];
        const bottom: number = borders[2] + padding[2];
        const left: number = borders[3] + padding[3];
        return [area[0] + left, area[1] + top, Math.max(0, area[2] - left - right), Math.max(0, area[3] - top - bottom)];
    }

    private order(first: Layer, second: Layer): number {
        return first.z - second.z;
    }

    private pageSupported(canvas: PageCanvas): void {
        if (canvas.orientation !== "upright") {
            throw new Error("The painting of page-orientation: " + canvas.orientation + " is not implemented");
        }
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
        // The clips of the boxes that hold a layer apply outside of its own transform.
        this.enter(entry.clips, pdf);
        if (this.preserves(entry) && (space === undefined || !space.extending.has(entry.fragment))) {
            this.establish(entry, pdf, root);
        } else if (entry.matrix === undefined) {
            this.grouped(entry, pdf, (target: PdfPage): void => this.stack(entry, target, root));
        } else {
            this.transformed(entry, entry.matrix, pdf, (target: PdfPage): void => this.stack(entry, target, root));
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
        return !clipping && ["filter", "clip-path", "mask-image"].every((property: string) => PagePainter.isNone(values[property]));
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
                this.transformed(plane.entry, plane.matrix, pdf, (target: PdfPage): void => this.stack(plane.entry, target, root && index === 0));
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

    private stack(entry: Layer, pdf: PdfPage, root: boolean): void {
        // CSS 2 Appendix E.2 gives the order.
        const layers: Array<Layer> = [];
        this.collect(entry.fragment, entry.transform, entry.frame, layers, true, [], undefined, undefined);
        this.box(entry.fragment, entry.transform, entry.frame, pdf, root);
        const order: (first: Layer, second: Layer) => number = (first: Layer, second: Layer): number => first.z - second.z;
        for (const layer of layers.filter((candidate: Layer) => candidate.context && candidate.z < 0).sort(order)) {
            this.context(layer, pdf, false);
        }
        this.content(entry, pdf);
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

    private content(entry: Layer, pdf: PdfPage): void {
        // CSS Text Decoration 4 §2: decorations are not propagated to out-of-flow boxes nor into atomic inlines, so what is
        // painted as a stacking context starts with its own decorations only.
        if (entry.fragment.box.replaced) {
            this.replaced(entry.fragment, entry.transform, entry.frame, pdf);
            return;
        }
        const inner: Transform = this.sizes.compose(entry.transform, this.sizes.inside(entry.fragment, entry.frame));
        const frame: number = this.sizes.frame(entry.fragment.box.style);
        const clipped: boolean = this.clip(entry.fragment, entry.transform, pdf);
        this.blocks(entry.fragment, inner, frame, pdf);
        this.floats(entry.fragment, inner, frame, pdf);
        this.inlines(entry.fragment, inner, frame, pdf, this.decorated([], entry.fragment.box.style));
        if (clipped) {
            pdf.content.restore();
        }
    }

    private replaced(fragment: BoxFragment, transform: Transform, frame: number, pdf: PdfPage): void {
        const clipped: boolean = this.clip(fragment, transform, pdf);
        this.linked(this.images.paint(fragment, transform, frame, pdf));
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
        // CSS Overflow 3 §3: the content is clipped to the padding box only in the axes that clip.
        const values: Readonly<Record<string, CssValue>> = fragment.box.style.values;
        const across: boolean = CLIPPING.has(this.keyword(values["overflow-x"]));
        const down: boolean = CLIPPING.has(this.keyword(values["overflow-y"]));
        // An image that is not clipped to its box of its own has only what overflow says, "any overflow of replaced content" being ink overflow.
        if ((!across && !down) || (fragment.box.replaced && !this.images.unclipped(fragment))) {
            return undefined;
        }
        const area: readonly [number, number, number, number] = this.sizes.mapped(transform, fragment.inline, fragment.block, fragment.inlineSize, fragment.blockSize);
        const rectangle: Rectangle = { x: area[0], y: area[1], width: area[2], height: area[3] };
        const edges: readonly [PhysicalSides, PhysicalSides] = this.edges(fragment);
        const inner: readonly [Rectangle, CornerRadii] = this.borders.inner(rectangle, edges[0], this.radii(fragment.box.style, rectangle));
        const clip: Rectangle = { ...inner[0] };
        // A clip is a closed path, so in the axis that does not clip it spans what the page shows, whose MediaBox ends what can be seen.
        if (!across) {
            clip.x = this.reach.x;
            clip.width = this.reach.width;
        }
        if (!down) {
            clip.y = this.reach.y;
            clip.height = this.reach.height;
        }
        return { rectangle: clip, radii: across && down ? inner[1] : NO_RADII };
    }

    private decorated(decorators: ReadonlyArray<ComputedStyle>, style: ComputedStyle): ReadonlyArray<ComputedStyle> {
        const line: CssValue | undefined = style.values["text-decoration-line"];
        return line === undefined || (line.kind === "ident" && line.lower === "none") ? decorators : [...decorators, style];
    }

    private collect(fragment: BoxFragment, transform: Transform, frame: number, layers: Array<Layer>, top: boolean, held: ReadonlyArray<Held>, view: Matrix4 | undefined, host: ElementBox | undefined): void {
        // CSS Overflow 3 §3: a clip holds the boxes whose containing block it contains, so it holds an absolutely positioned
        // box only when a positioned box comes between them.
        let passed: ReadonlyArray<Held> = held;
        const positioned: boolean = this.isPositioned(fragment.box);
        if (!top) {
            // Compositing 1 §3.1: a box with effects that group it is a stacking context painted as if positioned with z-index 0.
            const grouped: boolean = this.stacks(fragment.box);
            const z: number | undefined = positioned ? this.zIndex(fragment.box) : undefined;
            if (positioned || grouped) {
                const absolute: boolean = this.keyword(fragment.box.style.values["position"]) === "absolute";
                const clips: Array<Clip> = held.filter((entry: Held) => !absolute || entry.positioned).map((entry: Held) => entry.clip);
                layers.push(this.layer(fragment, transform, frame, z ?? 0, z !== undefined || grouped, clips, view, host));
                passed = positioned ? held.map((entry: Held): Held => ({ clip: entry.clip, positioned: true })) : held;
            }
            if (z !== undefined || grouped) {
                return;
            }
        }
        const clip: Clip | undefined = this.clipOf(fragment, transform);
        if (clip !== undefined) {
            passed = [...passed, { clip, positioned }];
        }
        const inner: Transform = this.sizes.compose(transform, this.sizes.inside(fragment, frame));
        const own: number = this.sizes.frame(fragment.box.style);
        // The perspective of a box reaches its element children, through the anonymous boxes between.
        // A table wrapper has no element but takes the transform properties of its table; an anonymous box has no values of its own.
        const named: boolean = fragment.box.element !== undefined || fragment.box.pseudoElement !== undefined || fragment.box.style.values !== fragment.box.style.inherited;
        const eye: Matrix4 | undefined = named ? this.eye(fragment, transform) : view;
        const next: ElementBox | undefined = named ? fragment.box : host;
        for (const child of fragment.children ?? []) {
            if (child.kind === "box") {
                this.collect(child, inner, own, layers, false, passed, eye, next);
                continue;
            }
            const line: Transform = this.lineTransform(inner, child);
            for (const piece of child.pieces) {
                if (piece.kind === "box") {
                    this.collect(piece, line, own, layers, false, passed, eye, next);
                }
            }
        }
    }

    private blocks(fragment: BoxFragment, transform: Transform, frame: number, pdf: PdfPage): void {
        for (const child of fragment.children ?? []) {
            if (child.kind === "box" && !this.isLayered(child.box) && child.box.placement !== "float") {
                this.box(child, transform, frame, pdf, false);
                const clipped: boolean = this.clip(child, transform, pdf);
                this.blocks(child, this.sizes.compose(transform, this.sizes.inside(child, frame)), this.sizes.frame(child.box.style), pdf);
                if (clipped) {
                    pdf.content.restore();
                }
            }
        }
    }

    private floats(fragment: BoxFragment, transform: Transform, frame: number, pdf: PdfPage): void {
        for (const child of fragment.children ?? []) {
            if (child.kind !== "box" || this.isLayered(child.box)) {
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
        // CSS Text Decoration 4 §2: decorations go on to the in-flow block-level children.
        for (const child of fragment.children ?? []) {
            if (child.kind === "line") {
                this.line(child, transform, frame, pdf, decorators);
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
        // CSS 2 Appendix E.2: the boxes and the runs of text of a line in tree order. CSS Text Decoration 4 §5.1: line-throughs
        // go over all of the line.
        const local: Transform = this.lineTransform(transform, line);
        const texts: ReadonlyArray<TextPiece> = line.pieces.filter((piece: TextPiece | BoxFragment): piece is TextPiece => piece.kind === "text");
        let runs: Array<TextPiece> = [];
        for (const piece of line.pieces) {
            if (piece.kind === "text") {
                runs.push(piece);
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
        this.text.decorate(line, texts, texts, transform, decorators, pdf, true);
    }

    private lineTransform(transform: Transform, line: LineFragment): Transform {
        return this.sizes.compose(transform, [1, 0, 0, 1, line.inline ?? 0, line.block]);
    }

    private box(fragment: BoxFragment, transform: Transform, frame: number, pdf: PdfPage, root: boolean): void {
        const box: ElementBox = fragment.box;
        const style: ComputedStyle = box.style;
        if (box.placement === "running" || box.placement === "footnote") {
            return;
        }
        this.supported(fragment);
        const area: readonly [number, number, number, number] = this.sizes.mapped(transform, fragment.inline, fragment.block, fragment.inlineSize, fragment.blockSize);
        const rectangle: Rectangle = { x: area[0], y: area[1], width: area[2], height: area[3] };
        const hidden: boolean = HIDDEN.has(this.keyword(style.values["visibility"]));
        this.anchor(fragment, rectangle, hidden);
        if (hidden) {
            return;
        }
        const own: number = this.sizes.frame(style);
        const [borders, padding]: readonly [PhysicalSides, PhysicalSides] = this.edges(fragment);
        const styles: Array<string> = ["none", "none", "none", "none"];
        const colors: Array<CssValue | undefined> = [undefined, undefined, undefined, undefined];
        for (let side: number = 0; side < 4; side++) {
            const physical: number = this.sizes.physicalSide(own, side);
            styles[physical] = this.keyword(style.values["border-" + SIDE_NAMES[side] + "-style"]);
            colors[physical] = style.values["border-" + SIDE_NAMES[side] + "-color"];
        }
        const radii: CornerRadii = this.radii(style, rectangle);
        if (!root) {
            const shapes: (form: PdfPage, text: boolean, border: boolean) => void = (form: PdfPage, text: boolean, border: boolean): void => {
                if (border) {
                    this.borders.paint(rectangle, borders, styles, OPAQUE_SIDES, style, form, radii);
                }
                if (text) {
                    this.textShapes(fragment, transform, frame, form);
                }
            };
            // CSS Transforms 1 §3: in a transformed box "a value of fixed for the background-attachment property is treated as
            // if it had a value of scroll".
            this.backgrounds.paint(rectangle, borders, padding, style, pdf, undefined, radii, this.moved ? { base: this.base, shapes } : { base: this.base, page: this.page, shapes });
        }
        if (fragment.collapsed !== undefined) {
            this.collapsed(fragment.collapsed, rectangle, own, pdf);
        } else if (!(box.display.inner === "table" && box.display.internal === undefined && this.keyword(style.values["border-collapse"]) === "collapse")) {
            // CSS 2 §17.6.2: in the collapsing model the borders of the table are those of its cells at its edges.
            this.borders.paint(rectangle, borders, styles, colors, style, pdf, radii);
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
                for (const child of box.children ?? []) {
                    if (child.kind === "box") {
                        if (!this.isLayered(child.box) && !child.box.replaced) {
                            walk(child, inner, own, decorating);
                        }
                        continue;
                    }
                    const local: Transform = this.lineTransform(inner, child);
                    for (const piece of child.pieces) {
                        if (piece.kind === "text") {
                            this.text.shapes(child, piece, inner, decorating, form);
                        } else if (!this.isLayered(piece.box) && !piece.box.replaced && !this.displays.isInlineBox(piece.box.display)) {
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
        if (page === undefined) {
            return;
        }
        const names: ReadonlyArray<string> | undefined = fragment.resumed === true ? undefined : this.setup.references.destinations(box);
        const shown: Rectangle | undefined = this.placed(rectangle);
        if (shown === undefined) {
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

    private linked(links: ReadonlyArray<readonly [PageRectangle, string, boolean]>): void {
        // The links inside an image, such as those of a formula, are areas of the page where the image is drawn.
        const page: PdfPage | undefined = this.annotated;
        if (page === undefined) {
            return;
        }
        for (const [rectangle, name, internal] of links) {
            const shown: Rectangle | undefined = this.placed({ x: rectangle.x, y: rectangle.y, width: rectangle.width, height: rectangle.height });
            if (shown === undefined) {
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
        const box: ElementBox = fragment.box;
        const values: Readonly<Record<string, CssValue>> = box.style.values;
        if (box.placement === "fixed") {
            throw new Error("position: fixed is not implemented");
        }
        PagePainter.effectsSupported(values, PAINTED_EFFECTS);
    }

    static effectsSupported(values: Readonly<Record<string, CssValue>>, painted: ReadonlySet<string> = NOT_PAINTED): void {
        for (const property of NONE_PROPERTIES) {
            if (!painted.has(property) && !PagePainter.isNone(values[property])) {
                throw new Error("The painting of " + property + " is not implemented");
            }
        }
        const opacity: CssValue | undefined = values["opacity"];
        if (!painted.has("opacity") && opacity !== undefined && ((opacity.kind === "number" && opacity.value < 1) || (opacity.kind === "percentage" && opacity.value < 100))) {
            throw new Error("The painting of opacity is not implemented");
        }
        const blend: CssValue | undefined = values["mix-blend-mode"];
        if (!painted.has("mix-blend-mode") && blend !== undefined && blend.kind === "ident" && blend.lower !== "none" && blend.lower !== "normal") {
            throw new Error("The painting of mix-blend-mode is not implemented");
        }
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
        // Compositing 1 §3.1 and CSS Transforms 1 §3: effects that group the box, or a transform of a transformable box.
        return this.grouping(box.style) !== undefined || (this.displays.isTransformable(box.display, box.replaced) && this.displays.isTransforming(box.style.values));
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
        // CSS 2 §9.9.1: a positioned box with an integer z-index establishes a stacking context, and with auto it does not.
        const value: CssValue | undefined = box.style.values["z-index"];
        return value !== undefined && value.kind === "number" ? value.value : undefined;
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
