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
import type { BoxFragment, BreakToken, LineFragment } from "../layout/Fragment.js";
import { PagePainter } from "../paint/PagePainter.js";
import type { SourceElement } from "../parse/SourceElement.js";
import type { PageSetup } from "../PdfGenerator.js";
import type { BoxNode, ElementBox, InlineSequence, InlineText, NamedString, TextSequence } from "../pdf/BoxTree.js";
import type { ComputedStyle } from "../pdf/ComputedStyle.js";
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
    margins?: Array<BoxFragment>;
    forms?: MarginForms;
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
    labelChanged: boolean = false;

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
        do {
            // CSS Paged Media 3 §8.1: "The first printed page's type is the start page value of the root", and content after a
            // break "resumes on a page box of the named type".
            const name: string = token === undefined ? root.startPage : this.setup.layout.resumedPage(token);
            const wanted: "left" | "right" | undefined = token === undefined ? undefined : this.wantedSide(token);
            if (wanted !== undefined && wanted !== side) {
                // CSS Fragmentation 4 §3.1: left, right, recto and verso force "one or two page breaks" so that the next page
                // has that side; Paged Media 3 §4.2.3: the page between is a blank page.
                this.finish(this.blank(side, position, token as BreakToken), token, state);
                side = this.opposite(side);
                position++;
            }
            const page: PageLayout = this.lay(root, name, side, position, state, token);
            this.breaks[position] = this.setup.layout.pageBreak;
            this.earlier[position] = this.setup.layout.pageEarlier;
            this.finish(page, token, state);
            token = page.content?.token;
            side = this.opposite(side);
            position++;
            // The pages already painted are thrown away, and the rest of this layout gives the pages of the later targets.
            if (state.painting && comparing && (references.moved || this.labelChanged)) {
                state.painting = false;
            }
        } while (token !== undefined);
        if (painting && !comparing) {
            references.reportUnsettled();
            if (this.labelChanged) {
                this.diagnostics.push("A bookmark label shows wrong string() values: each value moves its element. Allow a line break before it.");
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
        if (state.labels.length > 0) {
            // CSS Content 3 §3.2: a bookmark label reads the named strings of the page where its element starts, all of them.
            const strings: NamedValues<string> = state.strings.copy();
            for (const key of state.labels) {
                this.labelStrings.set(key, strings);
                this.labelChanged = this.labelChanged || this.setup.builder.labelMoved(key, strings);
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
                state.seen = state.seen || child.box.placement !== "running";
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

    private lay(root: ElementBox, name: string, side: "left" | "right", position: number, state: Pass, token?: BreakToken): PageLayout {
        // GCPM 3 §3.2: the page groups of a page are known from the boxes laid out on it, and they can change the page area
        // through :nth(); the page is laid out again in the new area until the groups no longer change it.
        let groups: Array<ElementBox> = this.continuing(token);
        let canvas: PageCanvas = this.canvas(name, side, position, false, groups);
        let end: Candidate | undefined = this.ends.get(position);
        let content: BoxFragment = this.content(root, canvas, token, end);
        const tried: Array<Rectangle> = [canvas.pageArea];
        const filled: Set<string> = new Set<string>();
        let previous: Candidate | undefined;
        for (;;) {
            const found: Array<ElementBox> = [];
            this.groupsIn(content, found);
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
            const filling: readonly [string, Map<InlineSequence, Array<readonly [[TextSequence, string], string]>>] | undefined = this.fillStrings(content, state);
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
            content = this.content(root, canvas, token, end);
        }
        this.count(groups);
        return { canvas, content };
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
        if (box.placement === "running") {
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

    private content(root: ElementBox, canvas: PageCanvas, token?: BreakToken, end?: Candidate): BoxFragment {
        const area: Rectangle = canvas.pageArea;
        return this.setup.layout.page(root, this.horizontal ? area.width : area.height, this.horizontal ? area.height : area.width, token, end);
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
