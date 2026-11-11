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
import type { BlockLayout, Candidate } from "../layout/BlockLayout.js";
import { BoxSizes } from "../layout/BoxSizes.js";
import type { BoxFragment, BreakToken, LineFragment, Margins } from "../layout/Fragment.js";
import { PagePainter } from "../paint/PagePainter.js";
import { SourceElement } from "../parse/SourceElement.js";
import type { PageSetup } from "../PdfGenerator.js";
import type { BoxNode, ElementBox, InlineItem, InlineSequence, InlineText, NamedString, TextSequence } from "../pdf/BoxTree.js";
import type { ComputedStyle } from "../pdf/ComputedStyle.js";
import type { DisplayType } from "../pdf/DisplayTypes.js";
import type { Counter, CounterChange, CounterSet } from "../pdf/CounterScopes.js";
import type { CrossReferences } from "../pdf/CrossReferences.js";
import { CounterScopes } from "../pdf/CounterScopes.js";
import type { PageCanvas, PageContext, PageGroup, PageMarginBox, Rectangle, Size } from "../pdf/PageCanvas.js";
import type { PdfDocument } from "../writer/PdfDocument.js";
import type { ImageResource, PdfPage } from "../writer/PdfPage.js";
import { MarginBoxes } from "./MarginBoxes.js";
import { NamedValues } from "./NamedValues.js";

export interface MarginForms {
    below?: ImageResource;
    above: ImageResource;
}

export interface PageLayout {
    canvas: PageCanvas;
    content?: BoxFragment;
    footnotes?: BoxFragment;
    margins?: Array<BoxFragment>;
    forms?: MarginForms;
}

interface Carry {
    nodes: ReadonlyArray<ElementBox>;
    token?: BreakToken;
}

interface Placed {
    fragment: BoxFragment;
    extent: number;
    fits: boolean;
    carry?: Carry;
}

interface Laid {
    content?: BoxFragment;
    footnotes?: BoxFragment;
    carry?: Carry;
}

interface LaterMargins {
    canvas: PageCanvas;
    counters: Array<Counter>;
    strings: NamedValues<string>;
    running: NamedValues<ElementBox>;
    forms: MarginForms;
    page: number;
    annotations: number;
    earlier: ReadonlyArray<number>;
}

interface Pass {
    painting: boolean;
    counters: Array<Counter>;
    node: number;
    strings: NamedValues<string>;
    running: NamedValues<ElementBox>;
    assigned: WeakSet<ReadonlyArray<NamedString>>;
    seen: boolean;
    trial: boolean;
    labels: Array<SourceElement | ElementBox>;
}

const POINTS_PER_PIXEL: number = 0.75;
const GROUP_BREAKS: ReadonlySet<string> = new Set<string>(["always", "all", "page", "left", "right", "recto", "verso"]);
const PAGE: string = "page";
const PAGES: string = "pages";
const TOLERANCE: number = 0.001;
const NO_CALLS: ReadonlySet<ElementBox> = new Set<ElementBox>();
const AREA_DISPLAY: DisplayType = { outer: "block", inner: "flow-root", listItem: false };
const RUN_DISPLAY: DisplayType = { outer: "block", inner: "flow", listItem: false };
const INLINE_DISPLAY: DisplayType = { outer: "inline", inner: "flow", listItem: false };
const NONE: CssValue = { kind: "ident", name: "none", lower: "none" };

export class PageDriver {

    private readonly setup: PageSetup;
    private readonly document: PdfDocument;
    private readonly painter: PagePainter;
    private readonly margins: MarginBoxes;
    private readonly scopes: CounterScopes = new CounterScopes();
    private readonly horizontal: boolean;
    private readonly groupPages: Map<ElementBox, number> = new Map<ElementBox, number>();
    private readonly stringItems: WeakMap<InlineSequence, ReadonlyArray<number>> = new WeakMap<InlineSequence, ReadonlyArray<number>>();
    private readonly later: Array<LaterMargins> = [];
    private readonly ends: ReadonlyMap<number, Candidate>;
    readonly labelStrings: Map<SourceElement | ElementBox, NamedValues<string>> = new Map<SourceElement | ElementBox, NamedValues<string>>();
    readonly breaks: Array<Candidate | undefined> = [];
    readonly earlier: Array<Candidate | undefined> = [];
    readonly diagnostics: Array<string> = [];
    private readonly movedLabels: Set<SourceElement | ElementBox> = new Set<SourceElement | ElementBox>();
    private readonly built: Array<readonly [ReadonlyArray<ElementBox>, ComputedStyle, ReadonlyArray<ElementBox>]> = [];
    private carry?: Carry;
    private nextCarry?: Carry;
    private order?: Map<ElementBox, number>;

    constructor(setup: PageSetup, document: PdfDocument, ends: ReadonlyMap<number, Candidate>) {
        this.setup = setup;
        this.document = document;
        this.ends = ends;
        this.painter = new PagePainter(setup, document);
        this.margins = new MarginBoxes(setup.layout, setup.text, setup.counterStyles, setup.references,
            (box: ElementBox, strings: NamedValues<string>): void => this.fillRunning(box, strings));
        // CSS Writing Modes 4 §6.1: the inline size of the page area is its width in a horizontal writing mode.
        const mode: CssValue | undefined = setup.root.values["writing-mode"];
        this.horizontal = mode === undefined || (mode.kind === "ident" && mode.lower === "horizontal-tb");
    }

    run(painting: boolean, comparing: boolean): boolean {
        const root: ElementBox = this.setup.boxes;
        const state: Pass = {
            painting, counters: [], node: this.scopes.node(), strings: new NamedValues<string>(), running: new NamedValues<ElementBox>(),
            assigned: new WeakSet<ReadonlyArray<NamedString>>(), seen: false, trial: false, labels: []
        };
        const references: CrossReferences = this.setup.references;
        references.startLayout();
        this.groupPages.clear();
        let token: BreakToken | undefined;
        let side: "left" | "right" = this.setup.firstSide;
        let position: number = 1;
        let ended: boolean = false;
        let last: string = root.startPage;
        delete this.carry;
        do {
            // CSS Paged Media 3 §8.1: "The first printed page's type is the start page value of the root", and content after a
            // break "resumes on a page box of the named type"; footnotes that go on after the content keep the last type.
            const name: string = token === undefined ? (ended ? last : root.startPage) : this.setup.layout.resumedPage(token);
            const wanted: "left" | "right" | undefined = token === undefined ? undefined : this.wantedSide(token);
            if (wanted !== undefined && wanted !== side) {
                // CSS Fragmentation 4 §3.1: left, right, recto and verso force "one or two page breaks" so that the next page
                // has that side; Paged Media 3 §4.2.3: the page between is a blank page.
                this.finish(this.blank(side, position, token as BreakToken), token, state);
                side = this.opposite(side);
                position++;
            }
            this.built.length = 0;
            const page: PageLayout = this.lay(root, name, side, position, state, ended, token);
            this.breaks[position] = page.content === undefined ? undefined : this.setup.layout.pageBreak;
            this.earlier[position] = page.content === undefined ? undefined : this.setup.layout.pageEarlier;
            this.finish(page, token, state);
            if (this.nextCarry === undefined) {
                delete this.carry;
            } else {
                this.carry = this.nextCarry;
            }
            if (page.content !== undefined) {
                token = page.content.token;
                ended = token === undefined;
            }
            last = name;
            side = this.opposite(side);
            position++;
            // The pages already painted are thrown away, and the rest of this layout gives the pages of the later targets.
            if (state.painting && comparing && (references.moved || this.movedLabels.size > 0)) {
                state.painting = false;
            }
        } while (token !== undefined || this.carry !== undefined);
        this.built.length = 0;
        if (painting && !comparing) {
            references.reportUnsettled();
            for (const key of this.movedLabels) {
                const element: SourceElement | undefined = key instanceof SourceElement ? key : key.element;
                this.diagnostics.push("The table of contents shows wrong string() values for <" + (element?.getName() ?? "") + ">: each value moves it. "
                    + "Allow a line break before it.");
            }
        }
        references.finishLayout();
        if (painting && !state.painting) {
            this.later.length = 0;
            return false;
        }
        // CSS Paged Media 3 §6.1: the pages counter "is always the total number of pages in the document".
        for (const kept of this.later) {
            const counters: Array<Counter> = [...kept.counters, { name: PAGES, creator: state.node, value: position - 1 }];
            const sheet: Size = kept.canvas.sheet;
            const annotations: PdfPage = this.document.annotationPage(kept.page, sheet.width * POINTS_PER_PIXEL, sheet.height * POINTS_PER_PIXEL);
            this.painter.margins(this.margins.boxes(kept.canvas, counters, kept.strings, kept.running), kept.forms, this.document, annotations);
            this.document.finishAnnotations(kept.annotations, [...kept.earlier, ...annotations.annotationObjects]);
        }
        this.later.length = 0;
        return true;
    }

    private finish(page: PageLayout, token: BreakToken | undefined, state: Pass): void {
        // CSS Paged Media 3 §6.1: the page counter "is automatically created and incremented by 1 on every page", unless the
        // counter-increment of the page context names it; the counter properties of the page context change it as well.
        const values: Readonly<Record<string, CssValue>> = page.canvas.style.values;
        const increments: Array<CounterChange> = [...(this.scopes.changes(1, values["counter-increment"]) ?? [])];
        if (!increments.some((change: CounterChange) => change[0] === PAGE)) {
            increments.push([PAGE, 1]);
        }
        this.scopes.apply(state.counters, state.node, this.scopes.changes(0, values["counter-reset"]), increments, this.scopes.changes(0, values["counter-set"]));
        state.strings.nextPage();
        state.running.nextPage();
        state.seen = false;
        if (page.content !== undefined) {
            this.assignments(page.content, state);
        }
        if (page.footnotes !== undefined) {
            this.assignments(page.footnotes, state);
        }
        if (state.labels.length > 0) {
            // CSS Content 3 §3.2: a bookmark label reads the named strings of the page where its element starts, all of them.
            const strings: NamedValues<string> = state.strings.copy();
            for (const key of state.labels) {
                this.labelStrings.set(key, strings);
                if (this.setup.builder.labelMoved(key, strings)) {
                    this.movedLabels.add(key);
                }
            }
            state.labels.length = 0;
        }
        let later: Omit<LaterMargins, "page" | "annotations" | "earlier"> | undefined;
        if (page.canvas.marginBoxes.length > 0 && state.painting) {
            // §6.1: the counters of the page context hide those of the document, which have the values they have at the start
            // of the page; pages cannot be changed, so it hides any counter of that name.
            const counters: Array<Counter> = [...this.documentCounters(token), ...state.counters.map((counter: Counter): Counter => ({ ...counter }))];
            if (this.setup.marginsLater) {
                // §4.2: the margin boxes do not change the page area, so they can wait for what only the whole layout gives.
                const sheet: Size = page.canvas.sheet;
                const forms: MarginForms = { above: this.document.reserveForm(sheet.width, sheet.height) };
                if (page.canvas.marginBoxes.some((margin: PageMarginBox) => this.zIndex(margin.style) < 0)) {
                    forms.below = this.document.reserveForm(sheet.width, sheet.height);
                }
                page.forms = forms;
                later = { canvas: page.canvas, counters, strings: state.strings.copy(), running: state.running.copy(), forms };
            } else {
                page.margins = this.margins.boxes(page.canvas, counters, state.strings, state.running);
            }
        }
        if (state.painting) {
            this.emit(page, later);
        }
    }

    private zIndex(style: ComputedStyle): number {
        const value: CssValue | undefined = style.values["z-index"];
        return value !== undefined && value.kind === "number" ? value.value : 0;
    }

    private documentCounters(token?: BreakToken): Array<Counter> {
        // CSS Paged Media 3 §6.1: "as if the page-margin box were an element within the document at the start of the page,
        // inside the deepest element in the normal flow that spans the page break".
        let counters: CounterSet | undefined = this.setup.boxes.counterStart;
        if (token !== undefined) {
            const resumed: readonly [ElementBox, BoxNode | undefined] = this.setup.layout.resumedAt(token);
            const next: BoxNode | undefined = resumed[1];
            counters = next !== undefined && next.kind === "box" && next.counterStart !== undefined ? next.counterStart : resumed[0].counterState;
        }
        return (counters ?? []).map((counter: Counter): Counter => ({ ...counter }));
    }

    private assignments(fragment: BoxFragment, state: Pass): void {
        // CSS Content 3 §2.7.2: a named string is assigned where the box of its element is first created, and GCPM 3 §1.2.2
        // takes a running element from where it would have been; start asks whether nothing came before it on the page.
        const box: ElementBox = fragment.box;
        if (box.placement === "running") {
            if (box.runningName !== undefined) {
                state.running.assign(box.runningName, box, !state.seen);
            }
            return;
        }
        if (box.placement === "footnote") {
            // GCPM 3 §2.2: the footnote element is in the footnote area, where its body is assigned; this is only its place.
            return;
        }
        if (fragment.resumed !== true) {
            this.assign(box.namedStrings, state);
            if (!state.trial && this.setup.references.recording) {
                this.setup.references.recordPage(box, this.pageNumber(state));
            }
            const key: SourceElement | ElementBox = box.pseudoElement === undefined && box.element !== undefined ? box.element : box;
            if (!state.trial && !this.labelStrings.has(key) && this.setup.builder.stringLabels?.has(key) === true) {
                state.labels.push(key);
            }
        }
        for (const child of fragment.children ?? []) {
            if (child.kind === "box") {
                this.assignments(child, state);
                state.seen = state.seen || (child.box.placement !== "running" && child.box.placement !== "footnote");
                continue;
            }
            this.lineAssignments(child, state);
            for (const piece of child.pieces) {
                if (piece.kind === "box") {
                    this.assignments(piece, state);
                }
            }
            state.seen = state.seen || child.pieces.length > 0;
        }
        if (fragment.token === undefined) {
            this.assign(box.trailingStrings, state);
        }
    }

    private pageNumber(state: Pass): number {
        for (let index: number = state.counters.length - 1; index >= 0; index--) {
            if (state.counters[index].name === PAGE) {
                return state.counters[index].value;
            }
        }
        return 0;
    }

    private lineAssignments(line: LineFragment, state: Pass): void {
        // The text of the document holds the strings of the elements without a box that come before it, at its start.
        const text: InlineText | undefined = line.sequence.text;
        if (text === undefined) {
            return;
        }
        let indexes: ReadonlyArray<number> | undefined = this.stringItems.get(line.sequence);
        if (indexes === undefined) {
            const found: Array<number> = [];
            for (const [index, item] of line.sequence.items.entries()) {
                if (item.kind === "text" && item.node.kind === "text" && item.node.namedStrings !== undefined) {
                    found.push(index);
                }
            }
            indexes = found;
            this.stringItems.set(line.sequence, indexes);
        }
        for (const index of indexes) {
            const position: number = text.starts[index];
            if (position >= line.start && (position < line.end || line.end === line.start)) {
                this.assign((line.sequence.items[index].node as TextSequence).namedStrings, state);
            }
        }
    }

    private assign(strings: ReadonlyArray<NamedString> | undefined, state: Pass): void {
        if (strings === undefined || state.assigned.has(strings)) {
            return;
        }
        state.assigned.add(strings);
        for (const [name, value] of strings) {
            state.strings.assign(name, value, !state.seen);
        }
    }

    private lay(root: ElementBox, name: string, side: "left" | "right", position: number, state: Pass, ended: boolean, token?: BreakToken): PageLayout {
        // GCPM 3 §3.2: the page groups of a page are known from the boxes laid out on it, and they can change the page area
        // through :nth(); the page is laid out again in the new area until the groups no longer change it.
        let groups: Array<ElementBox> = this.continuing(token);
        let canvas: PageCanvas = this.canvas(name, side, position, false, groups);
        let end: Candidate | undefined = this.ends.get(position);
        let laid: Laid = this.laid(root, canvas, ended, token, end);
        const tried: Array<Rectangle> = [canvas.pageArea];
        const filled: Set<string> = new Set<string>();
        let previous: Candidate | undefined;
        for (;;) {
            const content: BoxFragment | undefined = laid.content;
            const found: Array<ElementBox> = [];
            if (content !== undefined) {
                this.groupsIn(content, found);
            } else {
                found.push(...groups);
            }
            let again: boolean = false;
            if (found.length !== groups.length || found.some((box: ElementBox, index: number) => box !== groups[index])) {
                const next: PageCanvas = this.canvas(name, side, position, false, found);
                // The layout depends only on the page area, so an area laid out before means that the groups cycle, which
                // GCPM 3 does not resolve: the page keeps the area it was last laid out in.
                if (!this.sameArea(next.pageArea, canvas.pageArea) && tried.some((area: Rectangle) => this.sameArea(area, next.pageArea))) {
                    break;
                }
                again = !this.sameArea(next.pageArea, canvas.pageArea);
                groups = found;
                canvas = next;
                if (again) {
                    tried.push(canvas.pageArea);
                }
            }
            const filling: readonly [string, Map<InlineSequence, Array<readonly [[TextSequence, string], string]>>] | undefined = content === undefined ? undefined
                : this.fillStrings(content, state);
            if (filling !== undefined) {
                // Texts whose values move the content that assigns them, back and forth, end the page at the earlier break.
                const layout: BlockLayout = this.setup.layout;
                const earlier: Candidate | undefined = filled.has(filling[0])
                    ? layout.earlierOf(layout.pageBreak, previous, end) ?? layout.earlierOf(layout.pageEarlier, undefined, end) : undefined;
                if (earlier !== undefined) {
                    end = earlier;
                    filled.clear();
                }
                if (earlier !== undefined || !filled.has(filling[0])) {
                    filled.add(filling[0]);
                    this.renew(filling[1]);
                    again = true;
                } else if (state.painting) {
                    this.diagnostics.push("Page " + position + " shows wrong string() values: each value moves the element that sets it. Allow a line break before it.");
                }
            }
            if (!again) {
                break;
            }
            previous = this.setup.layout.pageBreak;
            laid = this.laid(root, canvas, ended, token, end);
        }
        this.count(groups);
        if (laid.carry === undefined) {
            delete this.nextCarry;
        } else {
            this.nextCarry = laid.carry;
        }
        const page: PageLayout = { canvas };
        if (laid.content !== undefined) {
            page.content = laid.content;
        }
        if (laid.footnotes !== undefined) {
            page.footnotes = laid.footnotes;
        }
        return page;
    }

    private laid(root: ElementBox, canvas: PageCanvas, ended: boolean, token?: BreakToken, end?: Candidate): Laid {
        const area: Rectangle = canvas.pageArea;
        const inline: number = this.horizontal ? area.width : area.height;
        const extent: number = this.horizontal ? area.height : area.width;
        if (!this.setup.builder.footnotes) {
            return { content: this.content(root, inline, extent, NO_CALLS, token, end) };
        }
        const layout: BlockLayout = this.setup.layout;
        const style: ComputedStyle = this.setup.canvases.footnoteStyle(canvas, this.setup.root, this.setup.viewport);
        // GCPM 3 §2.4.2: max-height limits the area "unless the page contains only footnotes"; the room the page gives the
        // area is the limit, so the area itself is laid out without it.
        const limit: number = Math.min(extent, layout.footnoteLimit(style, inline, extent));
        const unlimited: ComputedStyle = { ...style, values: Object.assign(Object.create(style.values) as Record<string, CssValue>, { "max-block-size": NONE }) };
        const carry: Carry | undefined = this.carry;
        if (ended) {
            return this.result(undefined, carry === undefined ? undefined : this.place(unlimited, carry, [], inline, extent, extent), extent);
        }
        let placed: Placed | undefined;
        let reserve: number = 0;
        if (carry !== undefined) {
            // XSL 1.1 §6.12.3: the rest of a footnote body goes on the next pages "before any other content is placed".
            placed = this.place(unlimited, carry, [], inline, extent, limit);
            if (placed.carry !== undefined && limit >= extent) {
                return this.result(undefined, placed, extent);
            }
            reserve = placed.extent;
        }
        const pushed: Set<ElementBox> = new Set<ElementBox>();
        let content: BoxFragment = this.content(root, inline, extent - reserve, pushed, token, end);
        // §2.4.2: "it is undesirable for a page to consist only of footnotes", which max-height prevents by keeping room for
        // the content; on the page where the content ends no content needs it, so the area takes the room the content leaves.
        const cap: number = content.token === undefined ? extent : limit;
        if (placed?.carry !== undefined && cap > limit) {
            placed = this.place(unlimited, carry, [], inline, extent, extent - this.used(content));
        }
        if (placed?.carry !== undefined) {
            // Footnotes keep their order, so those called on a page that still continues earlier ones start on a later page.
            return this.result(content, this.deferring(placed, this.calls(content, placed), style, inline), extent);
        }
        const accepted: Array<ElementBox> = [];
        for (;;) {
            const anchors: Array<ElementBox> = this.calls(content, placed);
            if (anchors.length <= accepted.length) {
                break;
            }
            const next: ElementBox = anchors[accepted.length];
            const room: number = Math.min(cap, extent - this.used(content));
            // GCPM 3 §2.2: the body goes in the footnote area of the page of its call, in the room the content leaves or in
            // the room it leaves once laid out again above a larger area.
            const trial: Placed = this.place(unlimited, carry, [...accepted, next], inline, extent, room);
            if (trial.carry === undefined && trial.fits) {
                accepted.push(next);
                placed = trial;
                continue;
            }
            const whole: Placed = this.place(unlimited, carry, [...accepted, next], inline, extent, cap);
            if (whole.carry === undefined && whole.fits) {
                const above: BoxFragment = this.content(root, inline, extent - whole.extent, pushed, token, end);
                if (this.calls(above, whole)[accepted.length] === next) {
                    accepted.push(next);
                    placed = whole;
                    reserve = whole.extent;
                    content = above;
                    continue;
                }
            }
            // §2.8: with line or block the call goes to the next page with its body, unless nothing comes before it here.
            const policy: CssValue | undefined = next.style.values["footnote-policy"];
            if (policy !== undefined && policy.kind === "ident" && policy.lower !== "auto" && !pushed.has(next)) {
                pushed.add(next);
                content = this.content(root, inline, extent - reserve, pushed, token, end);
                continue;
            }
            // With auto, XSL 1.1 §6.12.3: a body starts on the page of its call or a later one, and goes on in the next pages.
            const rest: ReadonlyArray<ElementBox> = anchors.slice(accepted.length);
            const split: Placed = this.place(unlimited, carry, [...accepted, ...rest], inline, extent, room);
            if (split.fits) {
                placed = split;
            } else if (placed === undefined) {
                const waiting: Carry | undefined = this.deferred(undefined, rest, style, inline);
                return waiting === undefined ? { content } : { content, carry: waiting };
            } else {
                placed = this.deferring(placed, rest, style, inline);
            }
            break;
        }
        if (placed !== undefined && Math.abs(placed.extent - reserve) > TOLERANCE) {
            // The boxes that break at the end of the content reach the area, which the room left gives exactly.
            const fitted: BoxFragment = this.content(root, inline, extent - placed.extent, pushed, token, end);
            const before: ReadonlyArray<ElementBox> = this.anchors(content);
            const after: ReadonlyArray<ElementBox> = this.anchors(fitted);
            if (before.length === after.length && before.every((box: ElementBox, index: number) => box === after[index])) {
                content = fitted;
            }
        }
        return this.result(content, placed, extent);
    }

    private result(content: BoxFragment | undefined, placed: Placed | undefined, extent: number): Laid {
        // GCPM 3 §2.4.1: "The bottom margin edge of the footnote area is positioned so that it touches the bottom of the page area."
        const laid: Laid = {};
        if (content !== undefined) {
            laid.content = content;
        }
        if (placed !== undefined) {
            placed.fragment.block = extent - placed.extent + this.sum(placed.fragment.marginBefore);
            laid.footnotes = placed.fragment;
            if (placed.carry !== undefined) {
                laid.carry = placed.carry;
            }
        }
        return laid;
    }

    private place(style: ComputedStyle, carry: Carry | undefined, bodies: ReadonlyArray<ElementBox>, inline: number, extent: number, space: number): Placed {
        const nodes: Array<ElementBox> = [...(carry?.nodes ?? []), ...this.nodes(bodies, style, inline)];
        const area: ElementBox = {
            kind: "box", style, display: AREA_DISPLAY, placement: "in-flow", replaced: false, hasStartEdge: true, hasEndEdge: true, usedPage: "", startPage: "", endPage: "",
            children: nodes
        };
        // The area of each page is a box of its own, which only resumes the footnote that the area of the page before broke.
        const previous: BreakToken | undefined = carry?.token;
        let incoming: BreakToken | undefined;
        if (previous !== undefined && (previous.inner !== undefined || previous.parallel !== undefined)) {
            incoming = { box: previous.box, consumed: 0, child: 0, sequence: 0 };
            if (previous.inner !== undefined) {
                incoming.inner = previous.inner;
            }
            if (previous.parallel !== undefined) {
                incoming.parallel = previous.parallel;
            }
        }
        const fragment: BoxFragment = this.setup.layout.footnoteArea(area, inline, extent, space, incoming);
        const size: number = this.sum(fragment.marginBefore) + fragment.blockSize + this.sum(fragment.marginAfter);
        const placed: Placed = { fragment, extent: size, fits: size <= space + TOLERANCE };
        const token: BreakToken | undefined = fragment.token;
        const rest: ReadonlyArray<ElementBox> = token === undefined ? [] : nodes.slice(token.child);
        if (token !== undefined && (rest.length > 0 || token.parallel !== undefined)) {
            placed.carry = { nodes: rest, token };
        }
        return placed;
    }

    private deferring(placed: Placed, bodies: ReadonlyArray<ElementBox>, style: ComputedStyle, inline: number): Placed {
        const result: Placed = { fragment: placed.fragment, extent: placed.extent, fits: placed.fits };
        const carry: Carry | undefined = this.deferred(placed.carry, bodies, style, inline);
        if (carry !== undefined) {
            result.carry = carry;
        }
        return result;
    }

    private deferred(carry: Carry | undefined, bodies: ReadonlyArray<ElementBox>, style: ComputedStyle, inline: number): Carry | undefined {
        const nodes: ReadonlyArray<ElementBox> = this.nodes(bodies, style, inline);
        if (nodes.length === 0) {
            return carry;
        }
        return carry === undefined ? { nodes } : { ...carry, nodes: [...carry.nodes, ...nodes] };
    }

    private nodes(bodies: ReadonlyArray<ElementBox>, style: ComputedStyle, inline: number): ReadonlyArray<ElementBox> {
        // GCPM 3 §2.3: footnote-display places a footnote in the area "as a block element" or "as an inline element"; with
        // compact "the user agent determines" it, and "If two or more footnotes could fit on the same line" they are inline.
        if (bodies.length === 0) {
            return [];
        }
        for (const [kept, keptStyle, nodes] of this.built) {
            if (keptStyle === style && kept.length === bodies.length && kept.every((body: ElementBox, index: number) => body === bodies[index])) {
                return nodes;
            }
        }
        const kinds: Array<string> = bodies.map((body: ElementBox): string => {
            const value: CssValue | undefined = body.style.values["footnote-display"];
            return value !== undefined && value.kind === "ident" ? value.lower : "block";
        });
        const line: number = kinds.includes("compact") ? this.setup.layout.lineSize(style, inline) : 0;
        const widths: Array<number> = bodies.map((body: ElementBox, index: number): number => kinds[index] === "compact" ? this.setup.layout.intrinsic(body)[1] : 0);
        const shares: (index: number, other: number) => boolean = (index: number, other: number): boolean => other >= 0 && other < bodies.length
            && kinds[other] !== "block" && widths[index] + (kinds[other] === "compact" ? widths[other] : 0) <= line + TOLERANCE;
        const nodes: Array<ElementBox> = [];
        let parts: Array<ElementBox> = [];
        let items: Array<InlineItem> = [];
        const flush: () => void = (): void => {
            if (items.length > 0) {
                nodes.push(this.shared(parts, items, style));
            }
            parts = [];
            items = [];
        };
        for (const [index, body] of bodies.entries()) {
            const inlined: boolean = kinds[index] === "inline" || (kinds[index] === "compact" && (shares(index, index - 1) || shares(index, index + 1)));
            if (!inlined) {
                flush();
                nodes.push({ ...body, placement: "in-flow", startPage: "", endPage: "" });
                continue;
            }
            // CSS 2 §9.2.1.1: an inline box that holds block-level boxes is broken around them.
            const segments: Array<ReadonlyArray<InlineItem> | ElementBox> = [];
            if (body.inline !== undefined && !body.children.some((child: BoxNode) => this.isBlock(child))) {
                segments.push(body.inline[0].items);
            } else {
                for (const child of body.children) {
                    if (child.kind !== "box") {
                        continue;
                    }
                    if (!this.isBlock(child)) {
                        segments.push([{ kind: "out-of-flow", node: child }]);
                    } else if (child.element === undefined && child.inline?.length === 1 && !child.children.some((node: BoxNode) => this.isBlock(node))) {
                        segments.push(child.inline[0].items);
                    } else {
                        segments.push(child);
                    }
                }
            }
            const count: number = segments.filter((segment: ReadonlyArray<InlineItem> | ElementBox) => Array.isArray(segment)).length;
            let seen: number = 0;
            for (const segment of segments) {
                if (!Array.isArray(segment)) {
                    flush();
                    nodes.push(segment as ElementBox);
                    continue;
                }
                const part: ElementBox = {
                    ...body, display: INLINE_DISPLAY, placement: "in-flow", hasStartEdge: seen === 0, hasEndEdge: seen === count - 1, startPage: "", endPage: "", children: []
                };
                seen++;
                parts.push(part);
                items.push({ kind: "open", node: part }, ...(segment as ReadonlyArray<InlineItem>), { kind: "close", node: part });
            }
        }
        flush();
        this.built.push([bodies, style, nodes]);
        return nodes;
    }

    private shared(parts: ReadonlyArray<ElementBox>, items: Array<InlineItem>, style: ComputedStyle): ElementBox {
        // The inline footnotes of a page share the lines of an anonymous block box, whose text is prepared for them.
        const anonymous: ComputedStyle = { values: style.inherited, inherited: style.inherited, custom: style.custom };
        if (style.zoom !== undefined) {
            anonymous.zoom = style.zoom;
        }
        const sequence: InlineSequence = { style: anonymous, items };
        this.setup.text.prepare([sequence]);
        return {
            kind: "box", style: anonymous, display: RUN_DISPLAY, placement: "in-flow", replaced: false, hasStartEdge: true, hasEndEdge: true, usedPage: "", startPage: "",
            endPage: "", children: [...parts], inline: [sequence]
        };
    }

    private isBlock(node: BoxNode): boolean {
        return node.kind === "box" && node.placement === "in-flow" && node.display.outer === "block";
    }

    private calls(content: BoxFragment, placed?: Placed): Array<ElementBox> {
        // GCPM 3 §2.2: any element with float: footnote is a footnote, so the calls in the footnote bodies on the page add
        // theirs after the calls of the content.
        const found: Array<ElementBox> = this.anchors(content);
        if (placed !== undefined) {
            this.anchors(placed.fragment, found);
        }
        // §2.2: "Footnote elements from a given page are placed in the footnote area of that page in document order."
        if (this.order === undefined) {
            this.order = new Map<ElementBox, number>();
            this.number(this.setup.boxes, this.order);
        }
        const order: Map<ElementBox, number> = this.order;
        return found.sort((first: ElementBox, second: ElementBox) => (order.get(first) ?? 0) - (order.get(second) ?? 0));
    }

    private number(box: ElementBox, order: Map<ElementBox, number>): void {
        for (const child of box.children) {
            if (child.kind === "box") {
                if (child.placement === "footnote") {
                    order.set(child, order.size);
                }
                this.number(child, order);
            }
        }
    }

    private anchors(fragment: BoxFragment, found: Array<ElementBox> = []): Array<ElementBox> {
        // The calls laid out on the page, in the order of their places.
        for (const child of fragment.children ?? []) {
            for (const piece of child.kind === "line" ? child.pieces : [child]) {
                if (piece.kind !== "box") {
                    continue;
                }
                if (piece.box.placement === "running") {
                    // GCPM 3 §1.2.1: a running element is "removed from the normal flow", and a footnote in it leaves its
                    // body where the element would have been, once, whatever the page-margin boxes repeat.
                    this.inside(piece.box, found);
                } else if (piece.box.placement !== "footnote") {
                    this.anchors(piece, found);
                } else if (!found.includes(piece.box)) {
                    found.push(piece.box);
                }
            }
        }
        return found;
    }

    private inside(box: ElementBox, found: Array<ElementBox>): void {
        for (const child of box.children) {
            if (child.kind !== "box") {
                continue;
            }
            if (child.placement !== "footnote") {
                this.inside(child, found);
            } else if (!found.includes(child)) {
                found.push(child);
            }
        }
    }

    private used(fragment: BoxFragment): number {
        // CSS Fragmentation 4 §5.3: a box that breaks fills the fragmentainer, so the room its content leaves is measured on
        // what it holds.
        return fragment.block + this.reach(fragment);
    }

    private reach(fragment: BoxFragment): number {
        if (fragment.token === undefined) {
            return fragment.blockSize;
        }
        const start: number = (fragment.border?.[BoxSizes.BLOCK_START] ?? 0) + (fragment.padding?.[BoxSizes.BLOCK_START] ?? 0);
        let bottom: number = 0;
        for (const child of fragment.children ?? []) {
            bottom = Math.max(bottom, child.block + (child.kind === "line" ? child.blockSize : this.reach(child)));
        }
        return start + bottom;
    }

    private sum(margins?: Margins): number {
        return margins === undefined ? 0 : margins[0] + margins[1];
    }

    private fillStrings(content: BoxFragment, state: Pass): readonly [string, Map<InlineSequence, Array<readonly [[TextSequence, string], string]>>] | undefined {
        const named: Map<readonly [string, string], [TextSequence, string]> = this.setup.builder.namedTexts;
        if (named.size === 0) {
            return undefined;
        }
        const found: Map<readonly [string, string], InlineSequence> = new Map<readonly [string, string], InlineSequence>();
        this.namedTexts(content, found);
        if (found.size === 0) {
            return undefined;
        }
        // §2.7.2: first, last and first-except read assignments that can come after the text on its page, so the whole page
        // is laid out before its texts are known.
        const strings: NamedValues<string> = state.strings.copy();
        strings.nextPage();
        const trial: Pass = {
            ...state, strings, running: new NamedValues<ElementBox>(), assigned: new WeakSet<ReadonlyArray<NamedString>>(), seen: false, trial: true, labels: []
        };
        this.assignments(content, trial);
        const values: Array<string> = [];
        const changed: Map<InlineSequence, Array<readonly [[TextSequence, string], string]>> = new Map<InlineSequence, Array<readonly [[TextSequence, string], string]>>();
        for (const [call, sequence] of found) {
            const value: string = strings.value(call[0], call[1]) ?? "";
            const entry: [TextSequence, string] | undefined = named.get(call);
            values.push(value);
            if (entry === undefined || entry[1] === value) {
                continue;
            }
            const nodes: Array<readonly [[TextSequence, string], string]> | undefined = changed.get(sequence);
            if (nodes === undefined) {
                changed.set(sequence, [[entry, value]]);
            } else {
                nodes.push([entry, value]);
            }
        }
        return changed.size === 0 ? undefined : [JSON.stringify(values), changed];
    }

    private fillRunning(box: ElementBox, strings: NamedValues<string>): void {
        // GCPM 3 §1.2.2: element() places the running element in a page-margin box, so its string() texts are those of that page.
        if (this.setup.builder.namedTexts.size === 0) {
            return;
        }
        const changed: Map<InlineSequence, Array<readonly [[TextSequence, string], string]>> = new Map<InlineSequence, Array<readonly [[TextSequence, string], string]>>();
        this.runningTexts(box, strings, changed);
        this.renew(changed);
    }

    private runningTexts(box: ElementBox, strings: NamedValues<string>, changed: Map<InlineSequence, Array<readonly [[TextSequence, string], string]>>): void {
        const named: Map<readonly [string, string], [TextSequence, string]> = this.setup.builder.namedTexts;
        for (const sequence of box.inline ?? []) {
            for (const item of sequence.items) {
                const call: readonly [string, string] | undefined = item.kind === "text" && item.node.kind === "text" ? item.node.named : undefined;
                const entry: [TextSequence, string] | undefined = call === undefined ? undefined : named.get(call);
                const value: string = call === undefined ? "" : strings.value(call[0], call[1]) ?? "";
                if (entry === undefined || entry[1] === value) {
                    continue;
                }
                const nodes: Array<readonly [[TextSequence, string], string]> | undefined = changed.get(sequence);
                if (nodes === undefined) {
                    changed.set(sequence, [[entry, value]]);
                } else {
                    nodes.push([entry, value]);
                }
            }
        }
        for (const child of box.children) {
            if (child.kind === "box") {
                this.runningTexts(child, strings, changed);
            }
        }
    }

    private renew(changed: ReadonlyMap<InlineSequence, ReadonlyArray<readonly [[TextSequence, string], string]>>): void {
        for (const [sequence, nodes] of changed) {
            this.setup.letters.undo(sequence);
            for (const [entry, value] of nodes) {
                entry[0].text = value;
                entry[1] = value;
            }
            this.setup.whiteSpace.again(sequence);
            this.setup.text.prepare([sequence, ...this.setup.letters.again(sequence)]);
            this.stringItems.delete(sequence);
        }
        if (changed.size > 0) {
            this.setup.layout.tables.forget();
            this.setup.builder.resetStrings();
        }
    }

    private namedTexts(fragment: BoxFragment, found: Map<readonly [string, string], InlineSequence>): void {
        // A sequence whose only text is still empty has no lines to place its texts by, so they take the page that holds
        // the whole box.
        const box: ElementBox = fragment.box;
        if (box.placement === "running" || box.placement === "footnote") {
            return;
        }
        for (const sequence of box.inline ?? []) {
            const indexes: Array<number> = [];
            for (const [index, item] of sequence.items.entries()) {
                if (item.kind === "text" && item.node.kind === "text" && item.node.named !== undefined) {
                    indexes.push(index);
                }
            }
            if (indexes.length === 0) {
                continue;
            }
            let lined: boolean = false;
            for (const child of fragment.children ?? []) {
                if (child.kind !== "line" || (child.sequence !== sequence && child.sequence !== sequence.firstLine)) {
                    continue;
                }
                lined = true;
                const text: InlineText = child.sequence.text as InlineText;
                for (const index of indexes) {
                    const position: number = text.starts[index];
                    const empty: boolean = text.starts[index + 1] === position;
                    if (position >= child.start && (position < child.end || child.end === child.start || (empty && position === child.end))) {
                        found.set((sequence.items[index].node as TextSequence).named as readonly [string, string], sequence);
                    }
                }
            }
            if (!lined && fragment.resumed !== true && fragment.token === undefined) {
                for (const index of indexes) {
                    found.set((sequence.items[index].node as TextSequence).named as readonly [string, string], sequence);
                }
            }
        }
        for (const child of fragment.children ?? []) {
            for (const piece of child.kind === "line" ? child.pieces : [child]) {
                if (piece.kind === "box") {
                    this.namedTexts(piece, found);
                }
            }
        }
    }

    private sameArea(first: Rectangle, second: Rectangle): boolean {
        return first.width === second.width && first.height === second.height;
    }

    private blank(side: "left" | "right", position: number, token: BreakToken): PageLayout {
        // GCPM 3 §3.2: a box the break goes through has not ended, so the page is one of its group; CSS Paged Media 3 §4.2:
        // a page type is "generated by the page property" of its content, and a blank page has none, so it has no name.
        const groups: Array<ElementBox> = this.continuing(token);
        const canvas: PageCanvas = this.canvas("", side, position, true, groups);
        this.count(groups);
        return { canvas };
    }

    private content(root: ElementBox, inline: number, extent: number, pushed: ReadonlySet<ElementBox>, token?: BreakToken, end?: Candidate): BoxFragment {
        const layout: BlockLayout = this.setup.layout;
        layout.pushCalls(pushed);
        const fragment: BoxFragment = layout.page(root, inline, extent, token, end);
        layout.pushCalls(NO_CALLS);
        return fragment;
    }

    private canvas(name: string, side: "left" | "right", position: number, blank: boolean, groups: ReadonlyArray<ElementBox>): PageCanvas {
        const pageGroups: Array<PageGroup> = groups.map((box: ElementBox): PageGroup => ({ name: box.usedPage, position: (this.groupPages.get(box) ?? 0) + 1 }));
        const context: PageContext = { first: position === 1, side, blank, position, groups: pageGroups };
        if (name.length > 0) {
            context.name = name;
        }
        return this.setup.canvases.build(context, this.setup.root, this.setup.viewport);
    }

    private continuing(token?: BreakToken): Array<ElementBox> {
        const boxes: Array<ElementBox> = [];
        for (let level: BreakToken | undefined = token; level !== undefined; level = level.inner) {
            if (this.isGroup(level.box)) {
                boxes.unshift(level.box);
            }
        }
        return boxes;
    }

    private groupsIn(fragment: BoxFragment, found: Array<ElementBox>): void {
        if (this.isGroup(fragment.box) && !found.includes(fragment.box)) {
            found.unshift(fragment.box);
        }
        for (const child of fragment.children ?? []) {
            for (const piece of child.kind === "line" ? child.pieces : [child]) {
                if (piece.kind === "box") {
                    this.groupsIn(piece, found);
                }
            }
        }
    }

    private isGroup(box: ElementBox): boolean {
        // GCPM 3 §3.2: "When the page property is applied to an element that also has a forced break property applied, a page
        // group is created", made of "all pages created by an instance of that element".
        const page: CssValue | undefined = box.style.values["page"];
        if (box.element === undefined || page === undefined || page.kind !== "ident" || page.lower === "auto") {
            return false;
        }
        const before: CssValue | undefined = box.style.values["break-before"];
        const after: CssValue | undefined = box.style.values["break-after"];
        return (before !== undefined && before.kind === "ident" && GROUP_BREAKS.has(before.lower)) || (after !== undefined && after.kind === "ident" && GROUP_BREAKS.has(after.lower));
    }

    private count(groups: ReadonlyArray<ElementBox>): void {
        for (const box of groups) {
            this.groupPages.set(box, (this.groupPages.get(box) ?? 0) + 1);
        }
    }

    private wantedSide(token: BreakToken): "left" | "right" | undefined {
        // CSS Fragmentation 4 §3.1: recto is the second page of a spread in the page progression and verso the first; the
        // first page of a document is a recto page (CSS Paged Media 3 §3.3).
        for (let level: BreakToken | undefined = token; level !== undefined; level = level.inner) {
            const forced: string | undefined = level.forced;
            if (forced === "left" || forced === "right") {
                return forced;
            }
            if (forced === "recto" || forced === "verso") {
                return forced === "recto" ? this.setup.recto : this.opposite(this.setup.recto);
            }
        }
        return undefined;
    }

    private opposite(side: "left" | "right"): "left" | "right" {
        return side === "left" ? "right" : "left";
    }

    private emit(page: PageLayout, later?: Omit<LaterMargins, "page" | "annotations" | "earlier">): void {
        const sheet: Size = page.canvas.sheet;
        const pdf: PdfPage = this.document.addPage(sheet.width * POINTS_PER_PIXEL, sheet.height * POINTS_PER_PIXEL);
        this.painter.paint(page, pdf);
        if (later !== undefined) {
            this.later.push({ ...later, page: pdf.object, annotations: this.document.deferAnnotations(pdf), earlier: [...pdf.annotationObjects] });
        }
        this.document.finishPage(pdf);
    }
}
