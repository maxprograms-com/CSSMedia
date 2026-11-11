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
import type { Transform } from "../layout/BoxSizes.js";
import { BoxSizes } from "../layout/BoxSizes.js";
import type { BoxFragment, CollapsedBorders, EdgeSource, LineFragment, TextPiece } from "../layout/Fragment.js";
import type { MarginForms, PageLayout } from "../pages/PageDriver.js";
import type { PageSetup } from "../PdfGenerator.js";
import type { ElementBox } from "../pdf/BoxTree.js";
import type { ComputedStyle } from "../pdf/ComputedStyle.js";
import { DisplayTypes } from "../pdf/DisplayTypes.js";
import type { PageCanvas, Rectangle, Size } from "../pdf/PageCanvas.js";
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

interface Layer {
    fragment: BoxFragment;
    transform: Transform;
    frame: number;
    z: number;
    context: boolean;
    clips: ReadonlyArray<Clip>;
}

const POINTS_PER_PIXEL: number = 0.75;
const PHYSICAL: number = 0;
const SIDE_NAMES: ReadonlyArray<string> = ["block-start", "inline-end", "block-end", "inline-start"];
const PHYSICAL_NAMES: ReadonlyArray<string> = ["top", "right", "bottom", "left"];
const HIDDEN: ReadonlySet<string> = new Set<string>(["hidden", "collapse"]);
const NONE_PROPERTIES: ReadonlyArray<string> = ["transform", "translate", "rotate", "scale", "filter", "backdrop-filter", "clip-path", "mask-image", "box-shadow-offset",
    "outline-style", "border-image-source"];
const RADII: ReadonlyArray<string> = ["border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius"];
const NO_SIDES: PhysicalSides = [0, 0, 0, 0];
const NO_RADII: CornerRadii = [0, 0, 0, 0, 0, 0, 0, 0];
const CLIPPING: ReadonlySet<string> = new Set<string>(["hidden", "clip", "scroll", "auto"]);
const UNSCALED: ReadonlyArray<number> = [1, 0, 0, 1, 0, 0];

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
    private sheet: Size = { width: 0, height: 0 };

    constructor(setup: PageSetup, document: PdfDocument) {
        this.setup = setup;
        this.document = document;
        const colors: ColorOutput = setup.colors;
        this.text = new TextPainter(document, colors, this.sizes, setup.metrics, setup.viewport, setup.palettes, setup.images);
        this.borders = new BorderPainter(colors);
        this.backgrounds = new BackgroundPainter(colors, this.borders);
        this.images = new ImagePainter(setup.images, this.sizes);
    }

    paint(page: PageLayout, pdf: PdfPage): void {
        // The layout is in CSS pixels, and the page in points.
        const canvas: PageCanvas = page.canvas;
        this.pageSupported(canvas);
        this.annotated = pdf;
        this.sheet = canvas.sheet;
        pdf.content.transform(POINTS_PER_PIXEL, 0, 0, POINTS_PER_PIXEL, 0, 0);
        // "its background painting area is the bleed area, which covers the entire page box, including its margins
        // (regardless of background-clip)".
        this.backgrounds.paint({ x: 0, y: 0, width: canvas.sheet.width, height: canvas.sheet.height }, NO_SIDES, NO_SIDES, canvas.style, pdf, "border-box");
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
        const pageBorders: PhysicalSides = [canvas.borders.top, canvas.borders.right, canvas.borders.bottom, canvas.borders.left];
        const pagePadding: PhysicalSides = [canvas.padding.top, canvas.padding.right, canvas.padding.bottom, canvas.padding.left];
        // "The document canvas background is drawn as the page box's background", in its border box with the
        // background-clip of the root element; CSS Backgrounds 3 §2.11.1: the root element does not paint it again.
        this.backgrounds.paint(canvas.borderBox, pageBorders, pagePadding, this.setup.root, pdf);
        this.borders.paint(canvas.borderBox, pageBorders, PHYSICAL_NAMES.map((side: string) => this.keyword(canvas.style.values["border-" + side + "-style"])),
            PHYSICAL_NAMES.map((side: string) => canvas.style.values["border-" + side + "-color"]), canvas.style, pdf);
        // GCPM 3 §2.4.1: the footnote area is placed in the page area, in the same coordinates as the content.
        for (const fragment of [page.content, page.footnotes]) {
            if (fragment === undefined) {
                continue;
            }
            const area: Rectangle = canvas.pageArea;
            const frame: number = this.sizes.frame((page.content ?? fragment).box.style);
            const transform: Transform = this.sizes.compose([1, 0, 0, 1, area.x, area.y], this.sizes.between(frame, PHYSICAL, area.width, area.height));
            this.context({ fragment, transform, frame, z: 0, context: true, clips: [] }, pdf, fragment === page.content);
        }
        for (const layer of margins.filter((candidate: Layer) => candidate.z >= 0).sort(this.order)) {
            this.context(layer, pdf, false);
        }
        if (forms !== undefined) {
            pdf.content.paintXObject(pdf.useImage(forms.above));
        }
    }

    margins(fragments: ReadonlyArray<BoxFragment>, forms: MarginForms, document: PdfDocument, page: PdfPage): void {
        this.annotated = page;
        this.sheet = forms.above;
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
        document.finishForm(form, [0, 0, reserved.width, reserved.height], UNSCALED);
    }

    private marginLayers(fragments: ReadonlyArray<BoxFragment>): Array<Layer> {
        return fragments.map((fragment: BoxFragment): Layer => ({ fragment, transform: BoxSizes.IDENTITY, frame: PHYSICAL, z: this.zIndex(fragment.box) ?? 0, context: true, clips: [] }));
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
        // CSS 2 Appendix E.2 gives the order.
        const layers: Array<Layer> = [];
        this.collect(entry.fragment, entry.transform, entry.frame, layers, true, []);
        this.enter(entry.clips, pdf);
        this.box(entry.fragment, entry.transform, pdf, root);
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
        this.leave(entry.clips, pdf);
    }

    private atomically(entry: Layer, pdf: PdfPage): void {
        // Appendix E.2: floats, atomic inlines and positioned boxes with z-index auto paint "as if it created a new stacking
        // context", their positioned and stacking descendants staying in the parent stacking context.
        this.enter(entry.clips, pdf);
        this.box(entry.fragment, entry.transform, pdf, false);
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
        // A clip is a closed path, so in the axis that does not clip it spans the sheet, whose MediaBox ends what can be seen.
        if (!across) {
            clip.x = 0;
            clip.width = this.sheet.width;
        }
        if (!down) {
            clip.y = 0;
            clip.height = this.sheet.height;
        }
        return { rectangle: clip, radii: across && down ? inner[1] : NO_RADII };
    }

    private decorated(decorators: ReadonlyArray<ComputedStyle>, style: ComputedStyle): ReadonlyArray<ComputedStyle> {
        const line: CssValue | undefined = style.values["text-decoration-line"];
        return line === undefined || (line.kind === "ident" && line.lower === "none") ? decorators : [...decorators, style];
    }

    private collect(fragment: BoxFragment, transform: Transform, frame: number, layers: Array<Layer>, top: boolean, held: ReadonlyArray<Held>): void {
        // CSS Overflow 3 §3: a clip holds the boxes whose containing block it contains, so it holds an absolutely positioned
        // box only when a positioned box comes between them.
        let passed: ReadonlyArray<Held> = held;
        const positioned: boolean = this.isPositioned(fragment.box);
        if (!top) {
            const z: number | undefined = positioned ? this.zIndex(fragment.box) : undefined;
            if (positioned) {
                const absolute: boolean = this.keyword(fragment.box.style.values["position"]) === "absolute";
                const clips: Array<Clip> = held.filter((entry: Held) => !absolute || entry.positioned).map((entry: Held) => entry.clip);
                layers.push({ fragment, transform, frame, z: z ?? 0, context: z !== undefined, clips });
                passed = held.map((entry: Held): Held => ({ clip: entry.clip, positioned: true }));
            }
            if (z !== undefined) {
                return;
            }
        }
        const clip: Clip | undefined = this.clipOf(fragment, transform);
        if (clip !== undefined) {
            passed = [...passed, { clip, positioned }];
        }
        const inner: Transform = this.sizes.compose(transform, this.sizes.inside(fragment, frame));
        const own: number = this.sizes.frame(fragment.box.style);
        for (const child of fragment.children ?? []) {
            if (child.kind === "box") {
                this.collect(child, inner, own, layers, false, passed);
                continue;
            }
            const line: Transform = this.lineTransform(inner, child);
            for (const piece of child.pieces) {
                if (piece.kind === "box") {
                    this.collect(piece, line, own, layers, false, passed);
                }
            }
        }
    }

    private blocks(fragment: BoxFragment, transform: Transform, frame: number, pdf: PdfPage): void {
        for (const child of fragment.children ?? []) {
            if (child.kind === "box" && !this.isPositioned(child.box) && child.box.placement !== "float") {
                this.box(child, transform, pdf, false);
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
            if (child.kind !== "box" || this.isPositioned(child.box)) {
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
            } else if (child.box.replaced && !this.isPositioned(child.box) && child.box.placement !== "float") {
                // CSS 2 Appendix E.2: "If the element is a block-level replaced element, then: the replaced content".
                this.replaced(child, transform, frame, pdf);
            } else if (!this.isPositioned(child.box) && child.box.placement !== "float") {
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
            } else if (!this.isPositioned(piece.box)) {
                this.text.runs(line, texts, runs, transform, decorators, pdf);
                runs = [];
                if (!piece.box.replaced && this.displays.isInlineBox(piece.box.display)) {
                    this.box(piece, local, pdf, false);
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

    private box(fragment: BoxFragment, transform: Transform, pdf: PdfPage, root: boolean): void {
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
            this.backgrounds.paint(rectangle, borders, padding, style, pdf, undefined, radii);
        }
        if (fragment.collapsed !== undefined) {
            this.collapsed(fragment.collapsed, rectangle, own, pdf);
        } else if (!(box.display.inner === "table" && box.display.internal === undefined && this.keyword(style.values["border-collapse"]) === "collapse")) {
            // CSS 2 §17.6.2: in the collapsing model the borders of the table are those of its cells at its edges.
            this.borders.paint(rectangle, borders, styles, colors, style, pdf, radii);
        }
    }

    private anchor(fragment: BoxFragment, rectangle: Rectangle, hidden: boolean): void {
        const page: PdfPage | undefined = this.annotated;
        const box: ElementBox = fragment.box;
        if (page === undefined) {
            return;
        }
        const names: ReadonlyArray<string> | undefined = fragment.resumed === true ? undefined : this.setup.references.destinations(box);
        for (const name of names ?? []) {
            this.document.addDestination(name, page, rectangle.x * POINTS_PER_PIXEL, rectangle.y * POINTS_PER_PIXEL);
        }
        if (hidden || rectangle.width <= 0 || rectangle.height <= 0 || (box.linkDestination === undefined && box.linkUri === undefined)) {
            return;
        }
        const area: PageRectangle = {
            x: rectangle.x * POINTS_PER_PIXEL, y: rectangle.y * POINTS_PER_PIXEL, width: rectangle.width * POINTS_PER_PIXEL, height: rectangle.height * POINTS_PER_PIXEL
        };
        if (box.linkDestination !== undefined) {
            this.document.linkToDestination(page, area, box.linkDestination);
        } else if (box.linkUri !== undefined) {
            this.document.linkToUri(page, area, box.linkUri);
        }
    }

    private linked(links: ReadonlyArray<readonly [PageRectangle, string, boolean]>): void {
        // The links inside an image, such as those of a formula, are areas of the page where the image is drawn.
        const page: PdfPage | undefined = this.annotated;
        if (page === undefined) {
            return;
        }
        for (const [rectangle, name, internal] of links) {
            const area: PageRectangle = {
                x: rectangle.x * POINTS_PER_PIXEL, y: rectangle.y * POINTS_PER_PIXEL, width: rectangle.width * POINTS_PER_PIXEL, height: rectangle.height * POINTS_PER_PIXEL
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
        PagePainter.effectsSupported(values);
    }

    static effectsSupported(values: Readonly<Record<string, CssValue>>): void {
        for (const property of NONE_PROPERTIES) {
            if (!PagePainter.isNone(values[property])) {
                throw new Error("The painting of " + property + " is not implemented");
            }
        }
        const opacity: CssValue | undefined = values["opacity"];
        if (opacity !== undefined && ((opacity.kind === "number" && opacity.value < 1) || (opacity.kind === "percentage" && opacity.value < 100))) {
            throw new Error("The painting of opacity is not implemented");
        }
        const blend: CssValue | undefined = values["mix-blend-mode"];
        if (blend !== undefined && blend.kind === "ident" && blend.lower !== "none" && blend.lower !== "normal") {
            throw new Error("The painting of mix-blend-mode is not implemented");
        }
    }

    private isPositioned(box: ElementBox): boolean {
        const position: string = this.keyword(box.style.values["position"]);
        return position !== "none" && position !== "static";
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
