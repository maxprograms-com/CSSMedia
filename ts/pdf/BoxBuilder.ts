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

import { TextNode } from "typesxml";
import { PropertyTable } from "../css/PropertyTable.js";
import type { ContainerQuery, Declaration, DeclaredValue, TocRule } from "../css/Stylesheet.js";
import type { CssValue } from "../css/values/CssValue.js";
import { SourceElement } from "../parse/SourceElement.js";
import type { BoxNode, ElementBox, NamedString, Placement, TextSequence } from "./BoxTree.js";
import type { Cascade } from "./Cascade.js";
import type { ComputedStyle } from "./ComputedStyle.js";
import { ContentValues } from "./ContentValues.js";
import type { Counter, CounterChange, CounterSet } from "./CounterScopes.js";
import type { CrossReferences } from "./CrossReferences.js";
import { CounterScopes } from "./CounterScopes.js";
import type { CounterStyles } from "./CounterStyles.js";
import type { DisplayType } from "./DisplayTypes.js";
import { DisplayTypes } from "./DisplayTypes.js";
import type { ContentState } from "./GeneratedContent.js";
import { GeneratedContent } from "./GeneratedContent.js";
import type { ImageFormats } from "../images/ImageFormats.js";
import type { NamedValues } from "../pages/NamedValues.js";
import type { Size } from "./PageCanvas.js";
import type { QuotePair, QuoteSystems } from "./QuoteSystems.js";
import { RubyBoxes } from "./RubyBoxes.js";
import { SelectorMatcher } from "./SelectorMatcher.js";
import type { QueryContainer } from "./StyleComputer.js";
import { StyleComputer } from "./StyleComputer.js";
import { TableBoxes } from "./TableBoxes.js";

interface Context {
    element: SourceElement;
    style: ComputedStyle;
    root: ComputedStyle;
    usedPage: string;
    node: number;
    counters: Array<Counter>;
    parent?: Context;
    placement: Placement;
    quotes?: ReadonlyArray<QuotePair>;
    generated?: Record<string, ReadonlyArray<BoxNode>>;
    scope?: number;
    size?: Size;
}

interface Deferral {
    context: Context;
    display: DisplayType;
    items?: Array<CssValue>;
    depth: number;
    entries?: ReadonlyArray<ReadonlyArray<CssValue>>;
    strings?: ReadonlyArray<NamedString>;
    trailing?: ReadonlyArray<NamedString>;
}

interface Built {
    nodes: Array<BoxNode>;
    counters?: CounterSet;
}

interface PseudoElement {
    name: string;
    style: ComputedStyle;
    display: DisplayType;
    items: Array<CssValue>;
}

interface FirstLetterSource {
    context: Context;
    prefix: boolean;
    suffix: boolean;
}

interface TargetStrings {
    strings: ReadonlyArray<NamedString>;
    entries: ReadonlyArray<ReadonlyArray<CssValue>>;
    element: SourceElement;
    style: ComputedStyle;
    state: ContentState;
    generated: Record<string, ReadonlyArray<BoxNode>>;
}

interface Bookmark {
    element: SourceElement;
    level: number;
    open: boolean;
    label: ReadonlyArray<CssValue>;
    entry?: ReadonlyArray<CssValue>;
    divider?: ReadonlyArray<CssValue>;
    style: ComputedStyle;
    state: ContentState;
    generated: Record<string, ReadonlyArray<BoxNode>>;
}

interface TocPlaceholder {
    box: ElementBox;
    holder: ComputedStyle;
    element: SourceElement;
    state: ContentState;
    usedPage: string;
}

const DEFAULT_LABEL: ReadonlyArray<CssValue> = [{ kind: "function", name: "content", args: [] }];
const PERCENT: RegExp = /%/g;
const DOTTED: CssValue = { kind: "ident", name: "dotted", lower: "dotted" };
const PAGE_COUNTER: CssValue = { kind: "ident", name: "page", lower: "page" };
const FIRST_LINE_EXCLUDED: ReadonlyArray<string> = ["writing-mode", "direction", "text-orientation"];
const SEGMENT_BREAK: RegExp = /\n/;
const ANONYMOUS_BLOCK: DisplayType = { outer: "block", inner: "flow", listItem: false };
const ANONYMOUS_CELL: DisplayType = { internal: "table-cell", outer: "block", inner: "flow-root", listItem: false };
const INLINE: DisplayType = { outer: "inline", inner: "flow", listItem: false };
const FOOTNOTE_CALL: string = "footnote-call";
const FOOTNOTE_MARKER: string = "footnote-marker";
const FOOTNOTE_COUNTER: string = "footnote";
const FOOTNOTE_START: ReadonlyArray<CounterChange> = [[FOOTNOTE_COUNTER, 0]];
const FOOTNOTE_STEP: ReadonlyArray<CounterChange> = [[FOOTNOTE_COUNTER, 1]];
const SAME_CONTEXT: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
    ["overflow-x", ["visible", "clip"]], ["overflow-y", ["visible", "clip"]], ["column-count", ["auto"]], ["column-width", ["auto"]]
];
const OWN_CONTEXT: number = DisplayTypes.LAYOUT_CONTAINMENT | DisplayTypes.PAINT_CONTAINMENT | DisplayTypes.SIZE_QUERIES;

export class BoxBuilder {

    static readonly FIRST_LINE: string = "first-line";
    static readonly FIRST_LETTER: string = "first-letter";
    static readonly FIRST_LETTER_PREFIX: string = "first-letter::prefix";
    static readonly FIRST_LETTER_SUFFIX: string = "first-letter::suffix";

    private readonly cascade: Cascade;
    private readonly computer: StyleComputer;
    private readonly images: ImageFormats;
    private readonly viewport: Size;
    private readonly quoteSystems: QuoteSystems;
    private readonly displays: DisplayTypes = new DisplayTypes();
    private readonly scopes: CounterScopes = new CounterScopes();
    private readonly contentValues: ContentValues = new ContentValues();
    private readonly ruby: RubyBoxes = new RubyBoxes();
    private readonly tables: TableBoxes = new TableBoxes((children: ReadonlyArray<BoxNode>, style: ComputedStyle, usedPage: string) =>
        this.blockContainerChildren(this.arranged(ANONYMOUS_CELL, children, style, usedPage), style, usedPage));
    private readonly content: GeneratedContent;
    private readonly firstLetters: Map<ElementBox, FirstLetterSource> = new Map<ElementBox, FirstLetterSource>();
    private readonly firstLetterRules: boolean;
    private readonly firstLines: Map<ElementBox, Context> = new Map<ElementBox, Context>();
    private readonly deferrals: Map<ElementBox, Deferral> = new Map<ElementBox, Deferral>();
    private readonly firstLineRules: boolean;
    private readonly contexts: Map<SourceElement, Context> = new Map<SourceElement, Context>();
    private readonly beforeRules: boolean;
    private readonly afterRules: boolean;
    private previous: CounterSet = [];
    private pendingStrings: Array<NamedString> = [];
    private readonly keepCounters: boolean;
    private readonly idCounters: boolean;
    private readonly references: CrossReferences;
    private readonly targetStrings: Array<TargetStrings> = [];
    private readonly bookmarks: Map<SourceElement | ElementBox, Bookmark | null> = new Map<SourceElement | ElementBox, Bookmark | null>();
    private readonly tocRules: ReadonlyArray<TocRule>;
    private readonly tocs: Array<TocPlaceholder> = [];
    private readonly calls: Array<readonly [ElementBox, SourceElement]> = [];
    readonly targets: Map<TextSequence, string> = new Map<TextSequence, string>();
    readonly namedTexts: Map<readonly [string, string], [TextSequence, string]> = new Map<readonly [string, string], [TextSequence, string]>();
    stringLabels?: Set<SourceElement | ElementBox>;
    labelStrings?: ReadonlyMap<SourceElement | ElementBox, NamedValues<string>>;
    private tocLabels?: Map<SourceElement, Array<TextSequence>>;
    rootStyle?: ComputedStyle;
    footnotes: boolean = false;
    readonly pageFootnotes: boolean;
    readonly footnoteNumbers: Map<SourceElement, readonly [number, number]> = new Map<SourceElement, readonly [number, number]>();
    footnoteStart: readonly [number, number] = [0, -1];

    constructor(cascade: Cascade, computer: StyleComputer, images: ImageFormats, viewport: Size, counterStyles: CounterStyles, quoteSystems: QuoteSystems,
        keepCounters: boolean, idCounters: boolean, references: CrossReferences, tocRules: ReadonlyArray<TocRule>, pageFootnotes: boolean) {
        this.cascade = cascade;
        this.pageFootnotes = pageFootnotes;
        this.tocRules = tocRules;
        this.computer = computer;
        this.images = images;
        this.viewport = viewport;
        this.quoteSystems = quoteSystems;
        this.keepCounters = keepCounters;
        this.idCounters = idCounters;
        this.references = references;
        this.content = new GeneratedContent(this.scopes, counterStyles, this.contentValues);
        this.firstLetterRules = cascade.usesPseudoElement(BoxBuilder.FIRST_LETTER) || cascade.usesPseudoElement(BoxBuilder.FIRST_LETTER_PREFIX)
            || cascade.usesPseudoElement(BoxBuilder.FIRST_LETTER_SUFFIX);
        this.firstLineRules = cascade.usesPseudoElement(BoxBuilder.FIRST_LINE);
        this.beforeRules = cascade.usesPseudoElement("before");
        this.afterRules = cascade.usesPseudoElement("after");
    }

    build(root: SourceElement): ElementBox | undefined {
        // CSS Display 3 §2.8: the root element's principal box is always blockified; display: none on it leaves no box tree.
        const style: ComputedStyle = this.style(root);
        this.rootStyle = style;
        const built: Built = this.element(root, style);
        this.expandTocs();
        this.linkCalls();
        return built.nodes.length === 1 && built.nodes[0].kind === "box" ? built.nodes[0] : undefined;
    }

    private style(element: SourceElement, parent?: ComputedStyle, root?: ComputedStyle, pseudoElement?: string, containers?: Context): ComputedStyle {
        // CSS Conditional 5 §5: the query containers of an element are its ancestors, and those of a pseudo-element the inclusive
        // ancestors of its originating element.
        const candidates: () => Iterable<QueryContainer> = (): Iterable<QueryContainer> => this.containers(containers);
        const own: ComputedStyle | undefined = pseudoElement === undefined ? this.images.elementStyle(element, parent, root, this.viewport, candidates) : undefined;
        if (own !== undefined) {
            return own;
        }
        const cascaded: Map<string, DeclaredValue> = this.cascade.element(element, (queries: ReadonlyArray<ContainerQuery>) =>
            this.computer.containersHold(queries, candidates, this.viewport), pseudoElement);
        return this.computer.compute(StyleComputer.input(cascaded, this.viewport, candidates, parent, root, element, pseudoElement));
    }

    private *containers(start: Context | undefined): Generator<QueryContainer> {
        for (let context: Context | undefined = start; context !== undefined; context = context.parent) {
            const container: QueryContainer = { element: context.element, style: context.style };
            if (context.size !== undefined) {
                container.size = context.size;
            }
            if (context.parent !== undefined) {
                container.parent = context.parent.style;
            }
            if (context.root !== undefined) {
                container.root = context.root;
            }
            yield container;
        }
    }

    private element(element: SourceElement, style: ComputedStyle, parent?: Context, sibling?: CounterSet): Built {
        const node: number = this.scopes.node(parent?.node);
        const counters: Array<Counter> = this.scopes.inherit(node, parent?.counters, sibling, this.previous);
        const display: DisplayType = this.displays.parse(style.values["display"]);
        // CSS Content 3 §2.7.2: a named string is assigned where the box of its element starts, which is known now; its text
        // can use the content of the element, which is known once that content is built.
        const entries: ReadonlyArray<ReadonlyArray<CssValue>> | undefined = this.stringEntries(style.values["string-set"]);
        const strings: Array<NamedString> | undefined = entries?.map((): NamedString => ["", ""]);
        // CSS Content 3 §3: under an element with style containment the bookmark properties "must have no effect".
        const level: CssValue | undefined = parent?.scope === undefined ? style.values["bookmark-level"] : undefined;
        const bookmarked: boolean = level !== undefined && level.kind === "number" && display.box !== "contents";
        if (display.box === "none") {
            if (this.bookmarks.has(element)) {
                this.bookmarks.set(element, null);
            }
            // "or would have been created if the element's display value is none", so they wait for the next box or text.
            this.previous = counters;
            if (entries !== undefined && strings !== undefined) {
                this.setStrings(strings, entries, element, style, this.contentState(counters, node, element, (): ReadonlyArray<QuotePair> => []));
                this.pendingStrings.push(...strings);
            }
            return { nodes: [], counters };
        }
        const placement: Placement = display.box === undefined ? this.placement(style, parent) : "in-flow";
        if (parent === undefined) {
            // GCPM 3 §2.5: the footnote counter is "a predefined counter", so it exists from the root for every footnote.
            this.scopes.apply(counters, node, FOOTNOTE_START);
            this.footnoteStart = [0, node];
        }
        const start: CounterSet | undefined = this.keepCounters || (this.idCounters && this.hasId(element)) ? this.copied(counters) : undefined;
        if (display.box === undefined) {
            // CSS Lists 3 §4.5 and §4.6: only an element that generates a box changes counters, and a list item increments
            // list-item; GCPM 3 §2.2: for a footnote element "The footnote counter is incremented."
            this.applyCounters(counters, node, style, display.listItem, parent?.scope);
            if (placement === "footnote") {
                this.scopes.apply(counters, node, undefined, FOOTNOTE_STEP, undefined, parent?.scope);
                this.footnotes = true;
                if (this.pageFootnotes) {
                    // The page driver numbers the footnotes again when the page context changes the counter, from these values
                    // and the counter instance that holds them.
                    for (let index: number = counters.length - 1; index >= 0; index--) {
                        if (counters[index].name === FOOTNOTE_COUNTER) {
                            this.footnoteNumbers.set(element, [counters[index].value, counters[index].creator]);
                            break;
                        }
                    }
                }
            }
        }
        this.previous = counters;
        const context: Context = { element, style, root: parent?.root ?? style, usedPage: this.usedPage(style, parent?.usedPage ?? ""), node, counters, placement };
        if (parent !== undefined) {
            context.parent = parent;
        }
        // An element that an image format draws, such as a formula, is replaced by its image; its subtree makes no boxes.
        const image: string | undefined = display.box === undefined ? this.images.elementImage(element, style) : undefined;
        const items: Array<CssValue> | undefined = image === undefined ? this.contentValues.items(style.values["content"]) : [{ kind: "url", href: image }];
        const replaced: boolean = items !== undefined && this.contentValues.isReplacement(items);
        // CSS Containment 2 §3.3: style containment scopes the counters and quotes of the element's subtree, the element itself
        // counted outside it.
        const containment: number = this.displays.containment(style.values, replaced && display.internal !== undefined ? INLINE : display, replaced);
        const scope: number | undefined = (containment & DisplayTypes.STYLE_CONTAINMENT) !== 0 ? node : parent?.scope;
        if (scope !== undefined) {
            context.scope = scope;
        }
        const deferred: boolean = (containment & DisplayTypes.SIZE_QUERIES) !== 0;
        if (entries !== undefined || bookmarked) {
            context.generated = {};
        }
        if (bookmarked && !this.bookmarks.has(element)) {
            // The outline is in document order, where an element comes before its descendants, which are built first.
            this.bookmarks.set(element, null);
        }
        if (this.firstLineRules) {
            this.contexts.set(element, context);
        }
        const call: ReadonlyArray<BoxNode> | undefined = placement === "footnote" ? this.footnoteCall(context) : undefined;
        // The strings waiting from elements without a box are assigned at the start of this box; an element with display:
        // contents has no box, so its own strings wait with them for its first box or text.
        const leading: Array<NamedString> | undefined = display.box === "contents" ? undefined : this.takeStrings();
        if (display.box === "contents" && strings !== undefined) {
            this.pendingStrings.push(...strings);
        }
        const depth: number = this.content.quoteDepth;
        const children: Array<BoxNode> = deferred ? this.waiting(context, items) : this.contentsOf(context, display, items);
        const state: ContentState = this.contentState(counters, node, element, (): ReadonlyArray<QuotePair> => this.contextQuotes(context));
        if (entries !== undefined && strings !== undefined) {
            this.setStrings(strings, entries, element, style, state, context.generated);
        }
        if (bookmarked && level !== undefined && level.kind === "number") {
            const bookmark: Bookmark = {
                element, level: level.value, open: !(display.outer === "block" && this.isClosed(style.values["bookmark-state"])),
                label: this.labelParts(style.values["bookmark-label"]), style, state, generated: context.generated as Record<string, ReadonlyArray<BoxNode>>
            };
            const entry: ReadonlyArray<CssValue> | undefined = this.optionalParts(style.values[PropertyTable.TOC_LABEL], "auto");
            const divider: ReadonlyArray<CssValue> | undefined = this.optionalParts(style.values[PropertyTable.TOC_DIVIDER], "none");
            if (entry !== undefined) {
                bookmark.entry = entry;
            }
            if (divider !== undefined) {
                bookmark.divider = divider;
            }
            this.bookmarks.set(element, bookmark);
            this.markStringLabel(element, bookmark);
            this.references.bookmark(element);
        } else if (this.bookmarks.has(element)) {
            this.bookmarks.set(element, null);
        }
        if (display.box === "contents") {
            // CSS Display 3 §2.5: the element is replaced in the box tree by its contents.
            return { nodes: children, counters };
        }
        const boxes: Array<BoxNode> = this.principalBox(element, style, display, replaced, context.usedPage, children, placement, this.alternativeText(style, state));
        this.assignStrings(boxes, strings === undefined ? leading : (leading === undefined ? strings : [...leading, ...strings]));
        this.keepState(boxes, counters, start);
        const first: BoxNode = boxes[0];
        if (deferred && first.kind === "box") {
            first.queryContainer = true;
            const deferral: Deferral = { context, display, depth };
            if (items !== undefined) {
                deferral.items = items;
            }
            if (entries !== undefined && strings !== undefined) {
                deferral.entries = entries;
                deferral.strings = strings;
            }
            if (first.trailingStrings !== undefined) {
                deferral.trailing = first.trailingStrings;
            }
            this.deferrals.set(first, deferral);
        }
        if ((this.firstLetterRules || this.firstLineRules) && !replaced && first.kind === "box" && this.displays.isBlockContainer(display)) {
            this.registerFirstLetter(first, context);
            this.registerFirstLine(first, context);
        }
        return { nodes: call === undefined ? boxes : [...call, ...boxes], counters };
    }

    private waiting(context: Context, items?: Array<CssValue>): Array<BoxNode> {
        // CSS Conditional 5 §5.1: the contents of a size query container, its pseudo-elements included, are built once layout
        // knows its size; a replaced element keeps its own content, which no query of the container decides.
        return items !== undefined && this.contentValues.isReplacement(items) ? [{ kind: "deferred", value: items[0], style: this.anonymousStyle(context.style) }] : [];
    }

    containerContents(box: ElementBox, inlineSize: number, blockSize?: number): boolean {
        // CSS Conditional 5 §5.1 and CSS Containment 2 §3.1: the container is sized as if empty, then its contents are laid
        // out in it; they are built here with the content box that its size queries and container query units read.
        const deferral: Deferral | undefined = this.deferrals.get(box);
        if (deferral === undefined) {
            return false;
        }
        const mode: CssValue | undefined = box.style.values["writing-mode"];
        const horizontal: boolean = mode === undefined || (mode.kind === "ident" && mode.lower === "horizontal-tb");
        // An inline-size container has no block size for its queries, which never read it.
        const block: number = blockSize ?? Number.NaN;
        const context: Context = deferral.context;
        const known: Size | undefined = context.size;
        if (known !== undefined && Object.is(known.width, horizontal ? inlineSize : block) && Object.is(known.height, horizontal ? block : inlineSize)) {
            return false;
        }
        context.size = horizontal ? { width: inlineSize, height: block } : { width: block, height: inlineSize };
        this.forget(box.children);
        const previous: CounterSet = this.previous;
        const pending: Array<NamedString> = this.pendingStrings;
        const depth: number = this.content.quoteDepth;
        this.previous = context.counters;
        this.pendingStrings = [];
        this.content.quoteDepth = deferral.depth;
        const children: Array<BoxNode> = this.contentsOf(context, deferral.display, deferral.items);
        if (deferral.entries !== undefined && deferral.strings !== undefined) {
            const state: ContentState = this.contentState(context.counters, context.node, context.element, (): ReadonlyArray<QuotePair> => this.contextQuotes(context));
            this.setStrings(deferral.strings, deferral.entries, context.element, context.style, state, context.generated);
        }
        this.fill(box, deferral.display, children);
        delete box.inline;
        if ((this.firstLetterRules || this.firstLineRules) && !box.replaced && this.displays.isBlockContainer(deferral.display)) {
            // The container is a query container of its own ::first-letter and ::first-line.
            this.firstLetters.delete(box);
            this.firstLines.delete(box);
            this.registerFirstLetter(box, context);
            this.registerFirstLine(box, context);
        }
        const trailing: Array<NamedString> | undefined = this.takeStrings();
        if (trailing === undefined && deferral.trailing === undefined) {
            delete box.trailingStrings;
        } else {
            box.trailingStrings = [...(deferral.trailing ?? []), ...(trailing ?? [])];
        }
        this.previous = previous;
        this.pendingStrings = pending;
        this.content.quoteDepth = depth;
        this.linkCalls();
        return true;
    }

    private forget(nodes: ReadonlyArray<BoxNode>): void {
        // The boxes of a container built for another size are left, with what was kept about them.
        for (const node of nodes) {
            if (node.kind === "box") {
                this.firstLetters.delete(node);
                this.firstLines.delete(node);
                this.deferrals.delete(node);
                this.forget(node.children);
            } else if (node.kind === "text") {
                if (node.target !== undefined || node.bookmark !== undefined) {
                    this.targets.delete(node);
                }
                if (node.named !== undefined) {
                    this.namedTexts.delete(node.named);
                }
            }
        }
        for (let index: number = this.targetStrings.length - 1; index >= 0; index--) {
            if (!this.holdsLaterText(this.targetStrings[index].generated)) {
                this.targetStrings.splice(index, 1);
            }
        }
    }

    targetText(node: TextSequence): string {
        if (node.bookmark !== undefined) {
            return this.labelText(node.bookmark[0], node.bookmark[1], this.labelStrings?.get(node.bookmark[0]));
        }
        if (node.target !== undefined && node.footnote !== undefined) {
            return this.content.footnoteText(node.target, node.style, node.text, this.references.footnoteNumber(node.footnote));
        }
        return node.target === undefined ? node.text : this.content.targetText(node.target, node.style, this.references);
    }

    labelTexts(): string {
        const texts: Array<string> = [];
        for (const nodes of this.tocLabels?.values() ?? []) {
            for (const node of nodes) {
                texts.push(this.targets.get(node) ?? "");
            }
        }
        return JSON.stringify(texts);
    }

    labelMoved(key: SourceElement | ElementBox, strings: NamedValues<string>): boolean {
        const nodes: ReadonlyArray<TextSequence> | undefined = key instanceof SourceElement ? this.tocLabels?.get(key) : undefined;
        return nodes !== undefined && nodes.some((node: TextSequence) => node.bookmark !== undefined
            && this.labelText(node.bookmark[0], node.bookmark[1], strings) !== this.targets.get(node));
    }

    private labelText(element: SourceElement, divider: boolean, strings?: NamedValues<string>): string {
        const bookmark: Bookmark | null | undefined = this.bookmarks.get(element);
        if (bookmark === null || bookmark === undefined) {
            return "";
        }
        const parts: ReadonlyArray<CssValue> = divider ? bookmark.divider ?? [] : bookmark.entry ?? bookmark.label;
        return this.content.namedText(parts, element, bookmark.style, bookmark.state, bookmark.generated, strings);
    }

    private tocText(element: SourceElement, divider: boolean, style: ComputedStyle, state: ContentState): Array<BoxNode> {
        // string() in the text of a bookmark takes the page of its element, which only a layout gives.
        const text: string = this.labelText(element, divider, this.labelStrings?.get(element));
        const bookmark: Bookmark | null | undefined = this.bookmarks.get(element);
        const parts: ReadonlyArray<CssValue> | undefined = bookmark === null || bookmark === undefined ? undefined : (divider ? bookmark.divider : bookmark.entry ?? bookmark.label);
        if (parts === undefined || !parts.some((part: CssValue) => part.kind === "function" && part.name === "string")) {
            return this.content.evaluate([{ kind: "string", value: text }], style, state);
        }
        const node: TextSequence = { kind: "text", text, style, bookmark: [element, divider] };
        if (state.language !== undefined) {
            node.language = state.language;
        }
        this.targets.set(node, text);
        this.tocLabels = this.tocLabels ?? new Map<SourceElement, Array<TextSequence>>();
        const nodes: Array<TextSequence> | undefined = this.tocLabels.get(element);
        if (nodes === undefined) {
            this.tocLabels.set(element, [node]);
        } else {
            nodes.push(node);
        }
        return [node];
    }

    resetStrings(): void {
        for (const kept of this.targetStrings) {
            this.setStrings(kept.strings, kept.entries, kept.element, kept.style, kept.state, kept.generated);
        }
    }

    bookmarkEntries(strings: (key: SourceElement | ElementBox) => NamedValues<string> | undefined): Array<readonly [SourceElement | ElementBox, number, boolean, string]> {
        const entries: Array<readonly [SourceElement | ElementBox, number, boolean, string]> = [];
        for (const [key, bookmark] of this.bookmarks) {
            if (bookmark !== null) {
                entries.push([key, bookmark.level, bookmark.open, this.content.namedText(bookmark.label, bookmark.element, bookmark.style, bookmark.state, bookmark.generated,
                    strings(key))]);
            }
        }
        return entries;
    }

    private markStringLabel(key: SourceElement | ElementBox, bookmark: Bookmark): void {
        // CSS Content 3 §3.2: bookmark-label is a <content-list>, so string() in it takes the value of the page of its element,
        // and so does the text of its entry in a table of contents.
        if ([...bookmark.label, ...(bookmark.entry ?? []), ...(bookmark.divider ?? [])].some((part: CssValue) => part.kind === "function" && part.name === "string")) {
            this.stringLabels = this.stringLabels ?? new Set<SourceElement | ElementBox>();
            this.stringLabels.add(key);
        }
    }

    private labelParts(value?: CssValue): ReadonlyArray<CssValue> {
        return this.optionalParts(value, "") ?? DEFAULT_LABEL;
    }

    private optionalParts(value: CssValue | undefined, keyword: string): ReadonlyArray<CssValue> | undefined {
        if (value === undefined || (value.kind === "ident" && value.lower === keyword)) {
            return undefined;
        }
        return value.kind === "list" && value.separator === "space" ? value.items : [value];
    }

    private withTocs(nodes: Array<BoxNode>, holder: ComputedStyle, element: SourceElement, state: ContentState, usedPage: string): Array<BoxNode> {
        // The entries of a table of contents can come after it in the document, so the toc function leaves an empty block
        // that is filled when the build ends.
        for (let index: number = 0; index < nodes.length; index++) {
            const node: BoxNode = nodes[index];
            if (node.kind === "deferred" && node.value.kind === "function" && node.value.name === PropertyTable.TOC) {
                const box: ElementBox = this.anonymousBlock([], holder, usedPage);
                nodes[index] = box;
                this.tocs.push({ box, holder, element, state, usedPage });
                this.bookmarks.set(box, null);
            }
        }
        return nodes;
    }

    private expandTocs(): void {
        for (const toc of this.tocs) {
            const title: ReadonlyArray<CssValue> | undefined = this.optionalParts(toc.holder.values[PropertyTable.TOC_TITLE], "none");
            const depth: CssValue | undefined = toc.holder.values[PropertyTable.TOC_DEPTH];
            const deepest: number = depth !== undefined && depth.kind === "number" ? depth.value : Number.POSITIVE_INFINITY;
            const entries: Array<readonly [SourceElement, Bookmark]> = [];
            for (const [key, bookmark] of this.bookmarks) {
                if (bookmark !== null && bookmark.level <= deepest && key instanceof SourceElement) {
                    entries.push([key, bookmark]);
                }
            }
            if (title === undefined || entries.length === 0) {
                continue;
            }
            const titleStyle: ComputedStyle = this.tocStyle(PropertyTable.TOC_TITLE, undefined, toc);
            const titleLevel: CssValue | undefined = titleStyle.values["bookmark-level"];
            if (titleLevel !== undefined && titleLevel.kind === "number") {
                const titleMark: Bookmark = {
                    element: toc.element, level: titleLevel.value, open: !this.isClosed(titleStyle.values["bookmark-state"]), label: title, style: titleStyle, state: toc.state,
                    generated: {}
                };
                this.bookmarks.set(toc.box, titleMark);
                this.markStringLabel(toc.box, titleMark);
                this.references.bookmark(toc.box);
            }
            const children: Array<BoxNode> = [this.tocBox(titleStyle, this.content.evaluate(title, this.anonymousStyle(titleStyle), toc.state), toc.usedPage)];
            for (const [element, bookmark] of entries) {
                if (bookmark.divider !== undefined) {
                    const style: ComputedStyle = this.tocStyle(PropertyTable.TOC_DIVIDER, bookmark.level, toc);
                    children.push(this.tocBox(style, this.tocText(element, true, this.anonymousStyle(style), toc.state), toc.usedPage));
                }
                const style: ComputedStyle = this.tocStyle(PropertyTable.TOC_ENTRY, bookmark.level, toc);
                const name: string = this.references.anchorName(element);
                const items: ReadonlyArray<CssValue> = [
                    { kind: "function", name: "leader", args: [style.values[PropertyTable.TOC_LEADER] ?? DOTTED] },
                    { kind: "function", name: "target-counter", args: [{ kind: "string", value: "#" + name }, PAGE_COUNTER] }
                ];
                const text: ComputedStyle = this.anonymousStyle(style);
                const box: ElementBox = this.tocBox(style, [...this.tocText(element, false, text, toc.state), ...this.content.evaluate(items, text, toc.state)], toc.usedPage);
                box.linkDestination = name;
                children.push(box);
            }
            toc.box.children = children;
            this.tables.pageValues(toc.box);
        }
    }

    private tocStyle(kind: string, level: number | undefined, toc: TocPlaceholder): ComputedStyle {
        // The rules for every level come before those for one level, and the important declarations after all the others.
        const cascaded: Map<string, DeclaredValue> = new Map<string, DeclaredValue>();
        const important: Array<Declaration> = [];
        for (const specific of [false, true]) {
            for (const rule of this.tocRules) {
                if (rule.kind !== kind || (rule.level !== undefined) !== specific || (specific && rule.level !== level)) {
                    continue;
                }
                for (const declaration of rule.declarations) {
                    if (declaration.important) {
                        important.push(declaration);
                    } else {
                        cascaded.delete(declaration.property);
                        cascaded.set(declaration.property, declaration.value);
                    }
                }
            }
        }
        for (const declaration of important) {
            cascaded.delete(declaration.property);
            cascaded.set(declaration.property, declaration.value);
        }
        return this.computer.compute(StyleComputer.input(cascaded, this.viewport, StyleComputer.NO_CONTAINERS, toc.box.style, this.rootStyle, toc.element));
    }

    private tocBox(style: ComputedStyle, children: Array<BoxNode>, usedPage: string): ElementBox {
        const box: ElementBox = {
            kind: "box", style, display: ANONYMOUS_BLOCK, placement: "in-flow", replaced: false, hasStartEdge: true, hasEndEdge: true, usedPage, startPage: usedPage,
            endPage: usedPage, children
        };
        this.tables.pageValues(box);
        return box;
    }

    private isClosed(value?: CssValue): boolean {
        return value !== undefined && value.kind === "ident" && value.lower === "closed";
    }

    private holdsLaterText(generated: Readonly<Record<string, ReadonlyArray<BoxNode>>>): boolean {
        const holds: (nodes: ReadonlyArray<BoxNode>) => boolean = (nodes: ReadonlyArray<BoxNode>): boolean => nodes.some((node: BoxNode) =>
            (node.kind === "text" && node.target !== undefined && this.targets.has(node)) || (node.kind === "text" && node.named !== undefined && this.namedTexts.has(node.named))
            || (node.kind === "box" && holds(node.children)));
        return Object.values(generated).some((nodes: ReadonlyArray<BoxNode>) => holds(nodes));
    }

    private hasId(element: SourceElement): boolean {
        return SelectorMatcher.ID_ATTRIBUTES.some((name: string) => element.getAttributeValue(name) !== undefined);
    }

    private footnoteCall(context: Context): ReadonlyArray<BoxNode> | undefined {
        // GCPM 3 §2.2: "The footnote element is removed from the flow, and a ::footnote-call pseudo-element is inserted in
        // its place", so its box is held by the box that holds the element's.
        const call: PseudoElement | undefined = this.pseudoElement(context, FOOTNOTE_CALL);
        if (call === undefined) {
            return undefined;
        }
        const nodes: Array<BoxNode> = this.pseudoBoxes(context, call, false, context.parent).nodes;
        for (const node of nodes) {
            if (node.kind === "box" && node.linkUri === undefined && node.linkDestination === undefined) {
                this.calls.push([node, context.element]);
            }
        }
        return nodes;
    }

    private linkCalls(): void {
        // GCPM 3 §2.2: the call "serves as a reference to the footnote", and XSL 1.1 §6.12.1.3 lets a user agent "create hot
        // links to the footnotes from the footnote-citation"; the name is given once the build has met every link.
        for (const [box, element] of this.calls) {
            this.references.bookmark(element);
            box.linkDestination = this.references.anchorName(element);
        }
        this.calls.length = 0;
    }

    private registerFirstLine(box: ElementBox, context: Context): void {
        // CSS Pseudo-Elements 4 §2.1.1: ::first-line "can only have an effect when attached to a block container".
        const candidates: () => Iterable<QueryContainer> = (): Iterable<QueryContainer> => this.containers(context);
        if (this.firstLineRules && this.cascade.element(context.element, (queries: ReadonlyArray<ContainerQuery>) =>
            this.computer.containersHold(queries, candidates, this.viewport), BoxBuilder.FIRST_LINE).size > 0) {
            this.firstLines.set(box, context);
        }
    }

    hasFirstLineOrigins(): boolean {
        return this.firstLetters.size > 0 || this.firstLines.size > 0;
    }

    originatesFirstLine(box: ElementBox): boolean {
        return this.firstLines.has(box);
    }

    firstLineStyle(origin: ElementBox, parent: ComputedStyle): ComputedStyle {
        // CSS Pseudo-Elements 4 §2.1.2: "User agents may apply other properties as well except for the following excluded
        // properties: writing-mode, direction, text-orientation", which the pseudo-element then inherits.
        const context: Context = this.firstLines.get(origin) as Context;
        const candidates: () => Iterable<QueryContainer> = (): Iterable<QueryContainer> => this.containers(context);
        const cascaded: Map<string, DeclaredValue> = this.cascade.element(context.element, (queries: ReadonlyArray<ContainerQuery>) =>
            this.computer.containersHold(queries, candidates, this.viewport), BoxBuilder.FIRST_LINE);
        for (const property of FIRST_LINE_EXCLUDED) {
            cascaded.delete(property);
        }
        return this.computer.compute(StyleComputer.input(cascaded, this.viewport, candidates, parent, context.root, context.element, BoxBuilder.FIRST_LINE));
    }

    firstLineBoxStyle(box: ElementBox, parent: ComputedStyle): ComputedStyle {
        // CSS Pseudo-Elements 4 §2.1.3: "the fragment of a child that occurs on the first line inherits any standard inherited
        // properties [...] from the ::first-line pseudo-element", so its style is computed again under that parent.
        const context: Context | undefined = box.element === undefined ? undefined : this.contexts.get(box.element);
        if (context === undefined) {
            return this.anonymousStyle(parent);
        }
        return this.style(context.element, parent, context.root, box.pseudoElement, box.pseudoElement === undefined ? context.parent : context);
    }

    private registerFirstLetter(box: ElementBox, context: Context): void {
        // CSS Pseudo-Elements 4 §2.2.2: ::first-letter "can only have an effect when attached to a block container". Its text
        // is known after white space processing, so the element is kept until then, only when a rule selects the pseudo-element.
        const candidates: () => Iterable<QueryContainer> = (): Iterable<QueryContainer> => this.containers(context);
        const selected: (name: string) => boolean = (name: string): boolean => this.cascade.usesPseudoElement(name)
            && this.cascade.element(context.element, (queries: ReadonlyArray<ContainerQuery>) => this.computer.containersHold(queries, candidates, this.viewport), name).size > 0;
        if (!this.firstLetterRules) {
            return;
        }
        const prefix: boolean = selected(BoxBuilder.FIRST_LETTER_PREFIX);
        const suffix: boolean = selected(BoxBuilder.FIRST_LETTER_SUFFIX);
        if (prefix || suffix || selected(BoxBuilder.FIRST_LETTER)) {
            this.firstLetters.set(box, { context, prefix, suffix });
        }
    }

    originatesFirstLetter(box: ElementBox): boolean {
        return this.firstLetters.has(box);
    }

    firstLetterBox(origin: ElementBox, name: string, parent: ComputedStyle): ElementBox | undefined {
        // CSS Pseudo-Elements 4 §2.2.3: ::prefix and ::suffix are there only "If any ::first-letter::prefix or
        // ::first-letter::suffix pseudo-elements exist"; §2.2.4: a ::first-letter "is similar to an inline box".
        const source: FirstLetterSource | undefined = this.firstLetters.get(origin);
        if (source === undefined || (name === BoxBuilder.FIRST_LETTER_PREFIX && !source.prefix) || (name === BoxBuilder.FIRST_LETTER_SUFFIX && !source.suffix)) {
            return undefined;
        }
        const context: Context = source.context;
        const style: ComputedStyle = this.style(context.element, parent, context.root, name, context);
        // CSS 2 §5.12.2: the first letter "is similar to an inline-level element if its 'float' property is 'none', otherwise
        // it is similar to a floated element".
        const float: CssValue | undefined = style.values["float"];
        const floated: boolean = name === BoxBuilder.FIRST_LETTER && float !== undefined && float.kind === "ident" && float.lower !== "none" && float.lower !== "footnote";
        return {
            kind: "box", element: context.element, pseudoElement: name, style, display: floated ? this.displays.parse(style.values["display"]) : INLINE,
            placement: floated ? "float" : "in-flow", replaced: false, hasStartEdge: true, hasEndEdge: true, usedPage: origin.usedPage, startPage: origin.usedPage,
            endPage: origin.usedPage, children: []
        };
    }

    private stringEntries(value?: CssValue): ReadonlyArray<ReadonlyArray<CssValue>> | undefined {
        // CSS Content 3 §2.7.1: "one or more named strings, corresponding to each comma-separated entry in the list", each
        // one a name followed by what makes its text.
        if (value === undefined || (value.kind === "ident" && value.lower === "none")) {
            return undefined;
        }
        let entries: Array<ReadonlyArray<CssValue>> | undefined;
        for (const entry of value.kind === "list" && value.separator === "comma" ? value.items : [value]) {
            const parts: ReadonlyArray<CssValue> = entry.kind === "list" && entry.separator === "space" ? entry.items : [entry];
            if (parts[0].kind === "ident") {
                entries = entries ?? [];
                entries.push(parts);
            }
        }
        return entries;
    }

    private setStrings(strings: ReadonlyArray<NamedString>, entries: ReadonlyArray<ReadonlyArray<CssValue>>, element: SourceElement, style: ComputedStyle,
        state: ContentState, generated?: Record<string, ReadonlyArray<BoxNode>>): void {
        for (const [index, parts] of entries.entries()) {
            const name: CssValue = parts[0];
            strings[index][0] = name.kind === "ident" ? name.name : "";
            strings[index][1] = this.content.namedText(parts.slice(1), element, style, state, generated);
        }
        if (generated !== undefined && !this.targetStrings.some((kept: TargetStrings) => kept.strings === strings) && this.holdsLaterText(generated)) {
            this.targetStrings.push({ strings, entries, element, style, state, generated });
        }
    }

    private takeStrings(): Array<NamedString> | undefined {
        if (this.pendingStrings.length === 0) {
            return undefined;
        }
        const taken: Array<NamedString> = this.pendingStrings;
        this.pendingStrings = [];
        return taken;
    }

    private assignStrings(boxes: ReadonlyArray<BoxNode>, leading?: Array<NamedString>): void {
        // CSS Content 3 §2.7.2: "The content values of named strings are assigned at the point when the content box of the
        // element is first created"; what the last elements without a box left is assigned where this box ends.
        const first: BoxNode = boxes[0];
        const last: BoxNode = boxes[boxes.length - 1];
        if (first.kind === "box" && leading !== undefined && leading.length > 0) {
            first.namedStrings = leading;
        }
        const trailing: Array<NamedString> | undefined = last.kind === "box" ? this.takeStrings() : undefined;
        if (last.kind === "box" && trailing !== undefined) {
            last.trailingStrings = trailing;
        }
    }

    private contentsOf(context: Context, display: DisplayType, items?: Array<CssValue>): Array<BoxNode> {
        // CSS Lists 3 §3.1 and CSS Pseudo-Elements 4 §4: ::marker, ::before, the contents and ::after, in this order; GCPM 3
        // §2.7: ::footnote-marker "is placed at the beginning of the superior parent's content, and is inline by default".
        const nodes: Array<BoxNode> = [];
        let sibling: CounterSet | undefined;
        // CSS Containment 2 §3.3: with style containment the quotes of the subtree start at the depth that their context
        // implies, and do not change the depth outside; the element's own content is outside.
        let inner: number = 0;
        const inside: <T>(build: () => T) => T = <T>(build: () => T): T => {
            if (context.scope !== context.node) {
                return build();
            }
            const outer: number = this.content.quoteDepth;
            this.content.quoteDepth = Math.max(0, outer + inner);
            const built: T = build();
            inner = this.content.quoteDepth - outer;
            this.content.quoteDepth = outer;
            return built;
        };
        const footnoteMarker: PseudoElement | undefined = context.placement === "footnote" ? this.pseudoElement(context, FOOTNOTE_MARKER) : undefined;
        if (footnoteMarker !== undefined) {
            const built: Built = inside((): Built => this.pseudoBoxes(context, footnoteMarker, false, context, sibling));
            nodes.push(...built.nodes);
            sibling = built.counters;
        }
        if (display.listItem && display.box === undefined) {
            const marker: Built | undefined = inside((): Built | undefined => this.marker(context, display, "marker", context, sibling));
            if (marker !== undefined) {
                nodes.push(...marker.nodes);
                sibling = marker.counters;
                this.keepGenerated(context, "marker", marker.nodes);
            }
        }
        if (items !== undefined && this.contentValues.isReplacement(items)) {
            // CSS Content 3 §1: a replaced element has no ::before or ::after.
            nodes.push({ kind: "deferred", value: items[0], style: this.anonymousStyle(context.style) });
            return nodes;
        }
        const before: PseudoElement | undefined = this.pseudoElement(context, "before");
        const after: PseudoElement | undefined = this.pseudoElement(context, "after");
        // CSS Content 3 §2.3: contents goes to the first of the element, ::before and ::after that uses it, counting only the
        // pseudo-elements that are generated; for the others it evaluates to nothing.
        const ownContents: boolean = items === undefined || this.contentValues.usesContents(items);
        const beforeContents: boolean = !ownContents && before !== undefined && this.contentValues.usesContents(before.items);
        const afterContents: boolean = !ownContents && !beforeContents && after !== undefined && this.contentValues.usesContents(after.items);
        if (before !== undefined) {
            const built: Built = inside((): Built => this.pseudoBoxes(context, before, beforeContents, context, sibling));
            nodes.push(...built.nodes);
            sibling = built.counters;
            this.keepGenerated(context, "before", built.nodes);
        }
        if (items === undefined) {
            const built: Built = inside((): Built => this.childBoxes(context, sibling));
            nodes.push(...built.nodes);
            sibling = built.counters;
        } else {
            // CSS Content 3 §1: a <content-list> on an element replaces its contents, which appear only where contents is used.
            const contents: (() => Array<BoxNode>) | undefined = ownContents ? this.once((): Array<BoxNode> => {
                const built: Built = inside((): Built => this.childBoxes(context, sibling));
                sibling = built.counters;
                return built.nodes;
            }) : undefined;
            const state: ContentState = this.contentState(context.counters, context.node, context.element, (): ReadonlyArray<QuotePair> => this.contextQuotes(context), contents);
            nodes.push(...this.withTocs(this.content.evaluate(this.withLinkCounters(items, context.element), this.anonymousStyle(context.style), state), context.style,
                context.element, state, context.usedPage));
        }
        if (after !== undefined) {
            const built: Built = inside((): Built => this.pseudoBoxes(context, after, afterContents, context, sibling));
            nodes.push(...built.nodes);
            this.keepGenerated(context, "after", built.nodes);
        }
        return nodes;
    }

    private keepGenerated(context: Context, name: string, nodes: ReadonlyArray<BoxNode>): void {
        // CSS Content 3 §2.7.3: content() in a named string can ask for the text of these boxes.
        if (context.generated !== undefined) {
            context.generated[name] = nodes;
        }
    }

    private childBoxes(context: Context, firstSibling?: CounterSet): Built {
        const boxes: Array<BoxNode> = [];
        let sibling: CounterSet | undefined = firstSibling;
        let text: string = "";
        const flush: () => void = (): void => {
            if (text.length > 0) {
                // Text of white space alone can be dropped from the box tree, so it does not take the waiting named strings.
                const strings: Array<NamedString> | undefined = SelectorMatcher.WHITESPACE_ONLY.test(text) ? undefined : this.takeStrings();
                const node: TextSequence = { kind: "text", text, style: this.anonymousStyle(context.style) };
                const language: string | undefined = this.cascade.languageOf(context.element);
                if (language !== undefined) {
                    node.language = language;
                }
                if (strings !== undefined) {
                    node.namedStrings = strings;
                }
                boxes.push(node);
                text = "";
            }
        };
        for (const child of context.element.getContent()) {
            if (child instanceof TextNode) {
                text += child.getValue();
            } else if (child instanceof SourceElement) {
                flush();
                const style: ComputedStyle = this.style(child, context.style, context.root, undefined, context);
                const built: Built = this.element(child, style, context, sibling);
                boxes.push(...built.nodes);
                sibling = built.counters;
            }
        }
        flush();
        return sibling === undefined ? { nodes: boxes } : { nodes: boxes, counters: sibling };
    }

    private pseudoElement(context: Context, name: string): PseudoElement | undefined {
        // CSS Content 3 §1: with content normal or none, ::before and ::after are not generated; normal is the initial value,
        // so without a cascaded content declaration there is no box and no style to compute.
        if ((name === "before" && !this.beforeRules) || (name === "after" && !this.afterRules)) {
            return undefined;
        }
        const candidates: () => Iterable<QueryContainer> = (): Iterable<QueryContainer> => this.containers(context);
        const cascaded: Map<string, DeclaredValue> = this.cascade.element(context.element, (queries: ReadonlyArray<ContainerQuery>) =>
            this.computer.containersHold(queries, candidates, this.viewport), name);
        if (!cascaded.has("content")) {
            return undefined;
        }
        const style: ComputedStyle = this.computer.compute(StyleComputer.input(cascaded, this.viewport, candidates, context.style, context.root, context.element, name));
        const display: DisplayType = this.displays.parse(style.values["display"]);
        const items: Array<CssValue> | undefined = this.contentValues.items(style.values["content"]);
        return items === undefined || display.box === "none" ? undefined : { name, style, display, items };
    }

    private pseudoBoxes(context: Context, pseudo: PseudoElement, takesContents: boolean, holder?: Context, sibling?: CounterSet): Built {
        const node: number = this.scopes.node(context.node);
        const counters: Array<Counter> = this.scopes.inherit(node, context.counters, sibling, this.previous);
        const start: CounterSet | undefined = this.keepCounters ? this.copied(counters) : undefined;
        if (pseudo.display.box === undefined) {
            this.applyCounters(counters, node, pseudo.style, pseudo.display.listItem, context.scope);
        }
        this.previous = counters;
        // The element's children keep inheriting from the element, but in the counter tree they descend from the pseudo-element.
        const pseudoContext: Context = { ...context, node, counters };
        const contents: (() => Array<BoxNode>) | undefined = takesContents ? this.once((): Array<BoxNode> => this.childBoxes(pseudoContext).nodes) : undefined;
        const state: ContentState = this.contentState(counters, node, context.element,
            (): ReadonlyArray<QuotePair> => this.quoteSystem(context.element, pseudo.style.values["quotes"], context), contents);
        if (this.pageFootnotes && (pseudo.name === FOOTNOTE_CALL || pseudo.name === FOOTNOTE_MARKER)) {
            state.footnote = context.element;
        }
        const leading: Array<NamedString> | undefined = pseudo.display.box === "contents" ? undefined : this.takeStrings();
        const generated: Array<BoxNode> = [];
        if (pseudo.display.listItem && pseudo.display.box === undefined) {
            // CSS Lists 3 §3.1 and Selectors 4 §3.6.4: a ::before or ::after that is a list item has its own marker as first child.
            const markerContext: Context = { ...context, style: pseudo.style, node, counters, parent: context };
            delete markerContext.quotes;
            const marker: Built | undefined = this.marker(markerContext, pseudo.display, pseudo.name + "::marker", context);
            if (marker !== undefined) {
                generated.push(...marker.nodes);
            }
        }
        // CSS Content 3 §1: content that is a single image makes the pseudo-element itself a replaced element, whose content
        // is that image; without a box of its own, the image is an anonymous inline replaced element.
        const replaced: boolean = pseudo.display.box !== "contents" && this.contentValues.isReplacement(pseudo.items);
        if (replaced) {
            generated.push({ kind: "deferred", value: pseudo.items[0], style: this.anonymousStyle(pseudo.style) });
        } else {
            const items: Array<CssValue> = this.withLinkCounters(pseudo.items, context.element, pseudo.name, pseudo.style.values[PropertyTable.LINK]);
            generated.push(...this.withTocs(this.content.evaluate(items, this.anonymousStyle(pseudo.style), state), pseudo.style, context.element, state,
                this.usedPage(pseudo.style, context.usedPage)));
        }
        if (pseudo.display.box === "contents") {
            return { nodes: generated, counters };
        }
        const usedPage: string = this.usedPage(pseudo.style, context.usedPage);
        const boxes: Array<BoxNode> = this.principalBox(context.element, pseudo.style, pseudo.display, replaced, usedPage, generated, this.placement(pseudo.style, holder),
            this.alternativeText(pseudo.style, state), pseudo.name);
        this.assignStrings(boxes, leading);
        this.keepState(boxes, counters, start);
        return { nodes: boxes, counters };
    }

    private copied(counters: ReadonlyArray<Counter>): CounterSet {
        return counters.map((counter: Counter): Counter => ({ ...counter }));
    }

    private keepState(boxes: ReadonlyArray<BoxNode>, counters: CounterSet, start?: CounterSet): void {
        // CSS Paged Media 3 §6.1: a counter of the document that a page-margin box uses has the value it would have "as if
        // the page-margin box were an element within the document at the start of the page", before or inside the box there.
        const first: BoxNode | undefined = boxes[0];
        if (start !== undefined && first !== undefined && first.kind === "box") {
            first.counterStart = start;
            first.counterState = counters;
        }
    }

    private marker(context: Context, elementDisplay: DisplayType, name: string, origin: Context, sibling?: CounterSet): Built | undefined {
        // CSS Lists 3 §3.2: the marker's contents come from content, or else from list-style-image, or else from list-style-type;
        // with none of them ::marker generates no box.
        const style: ComputedStyle = this.style(context.element, context.style, context.root, name, origin);
        const content: CssValue | undefined = style.values["content"];
        const items: Array<CssValue> | undefined = this.contentValues.items(content);
        const text: ComputedStyle = this.anonymousStyle(style);
        if ((content !== undefined && content.kind === "ident" && content.lower === "none") || (items === undefined && !this.content.hasMarker(text))) {
            return undefined;
        }
        const node: number = this.scopes.node(context.node);
        const counters: Array<Counter> = this.scopes.inherit(node, context.counters, sibling, this.previous);
        this.applyCounters(counters, node, style, false, context.scope);
        this.previous = counters;
        const state: ContentState = this.contentState(counters, node, context.element,
            (): ReadonlyArray<QuotePair> => this.quoteSystem(context.element, style.values["quotes"], context));
        const generated: Array<BoxNode> = items === undefined ? this.content.marker(text, state)
            : this.content.evaluate(this.withLinkCounters(items, context.element, name, style.values[PropertyTable.LINK]), text, state);
        // CSS Lists 3 §3.5: an outside marker of a block container is a block container placed outside the principal box; for an
        // inline list item outside is the same as inside, and an inside marker is an inline box at the start of the contents.
        const position: CssValue | undefined = style.values["list-style-position"];
        const inside: boolean = position !== undefined && position.kind === "ident" && position.lower === "inside";
        const outside: boolean = !inside && elementDisplay.outer === "block" && this.displays.isBlockContainer(elementDisplay);
        const box: ElementBox = {
            kind: "box", element: context.element, pseudoElement: name, style, display: outside ? ANONYMOUS_BLOCK : INLINE, placement: outside ? "marker" : "in-flow",
            replaced: false, hasStartEdge: true, hasEndEdge: true, usedPage: context.usedPage, startPage: context.usedPage, endPage: context.usedPage, children: generated
        };
        const alternative: string | undefined = this.alternativeText(style, state);
        if (alternative !== undefined) {
            box.alternativeText = alternative;
        }
        return { nodes: [box], counters };
    }

    private withLinkCounters(items: Array<CssValue>, element: SourceElement, pseudoElement?: string, value?: CssValue): Array<CssValue> {
        if (!items.some((item: CssValue) => item.kind === "function" && item.name === PropertyTable.LINK_COUNTER)) {
            return items;
        }
        const link: string | undefined = (pseudoElement === undefined ? undefined : this.cascade.linkOf(element, pseudoElement, value)) ?? this.cascade.linkOf(element);
        const name: string | undefined = link === undefined ? undefined : this.references.link(link, this.cascade.linkTarget(link));
        const result: Array<CssValue> = [];
        for (const item of items) {
            if (item.kind !== "function" || item.name !== PropertyTable.LINK_COUNTER) {
                result.push(item);
            } else if (name !== undefined) {
                result.push({ kind: "function", name: "target-counter", args: [{ kind: "string", value: "#" + name.replace(PERCENT, "%25") }, ...item.args] });
            }
        }
        return result;
    }

    private once(build: () => Array<BoxNode>): () => Array<BoxNode> {
        // CSS Content 3 §2.3: the contents can be used only once.
        let used: boolean = false;
        return (): Array<BoxNode> => {
            if (used) {
                return [];
            }
            used = true;
            return build();
        };
    }

    private applyCounters(counters: Array<Counter>, node: number, style: ComputedStyle, listItem: boolean, scope?: number): void {
        let increments: Array<CounterChange> | undefined = this.scopes.changes(1, style.values["counter-increment"]);
        if (listItem && increments?.some((change: CounterChange) => change[0] === GeneratedContent.LIST_ITEM) !== true) {
            increments = increments ?? [];
            increments.push([GeneratedContent.LIST_ITEM, 1]);
        }
        this.scopes.apply(counters, node, this.scopes.changes(0, style.values["counter-reset"]), increments, this.scopes.changes(0, style.values["counter-set"]), scope);
    }

    private contentState(counters: Array<Counter>, node: number, element: SourceElement, quotes: () => ReadonlyArray<QuotePair>,
        contents?: () => Array<BoxNode>): ContentState {
        const state: ContentState = { counters, node, quotes, references: this.references, targets: this.targets, named: this.namedTexts };
        const language: string | undefined = this.cascade.languageOf(element);
        if (language !== undefined) {
            state.language = language;
        }
        if (contents !== undefined) {
            state.contents = contents;
        }
        return state;
    }

    private contextQuotes(context: Context): ReadonlyArray<QuotePair> {
        if (context.quotes === undefined) {
            context.quotes = this.quoteSystem(context.element, context.style.values["quotes"], context.parent);
        }
        return context.quotes;
    }

    private quoteSystem(element: SourceElement, value?: CssValue, parent?: Context): ReadonlyArray<QuotePair> {
        // CSS Content 3 §2.4.1: auto follows the content language of the parent, or of the element itself when it has no parent;
        // match-parent takes the parent's quotation mark system, with an auto resolved in the parent's language.
        const keyword: string | undefined = value !== undefined && value.kind === "ident" ? value.lower : undefined;
        if (keyword === "none") {
            return [];
        }
        if (keyword === "match-parent" && parent !== undefined) {
            return this.contextQuotes(parent);
        }
        if (value === undefined || keyword !== undefined) {
            return this.quoteSystems.forLanguage(this.cascade.languageOf(parent?.element ?? element) ?? "");
        }
        const strings: Array<string> = [];
        for (const item of value.kind === "list" ? value.items : [value]) {
            if (item.kind === "string") {
                strings.push(item.value);
            }
        }
        const pairs: Array<QuotePair> = [];
        for (let index: number = 0; index + 1 < strings.length; index += 2) {
            pairs.push([strings[index], strings[index + 1]]);
        }
        return pairs;
    }

    private principalBox(element: SourceElement, style: ComputedStyle, display: DisplayType, replaced: boolean, usedPage: string,
        children: ReadonlyArray<BoxNode>, placement: Placement, alternativeText?: string, pseudoElement?: string): Array<BoxNode> {
        // CSS Display 3 §2.4: a replaced element with a layout-internal display "is handled as having a used value of inline";
        // CSS Ruby 1 §2.1.2: a ruby principal box with another outer type than inline holds an inline-level ruby container.
        let used: DisplayType = replaced && display.internal !== undefined ? INLINE : display;
        if (!replaced && this.displays.isRubyContainer(display) && display.outer !== "inline") {
            used = { ...display, inner: "flow" };
        }
        const box: ElementBox = {
            kind: "box", element, style, display: used, placement, replaced, hasStartEdge: true, hasEndEdge: true, usedPage, startPage: usedPage,
            endPage: usedPage, children: []
        };
        if (pseudoElement !== undefined) {
            box.pseudoElement = pseudoElement;
        }
        const running: string | undefined = this.runningName(style);
        if (alternativeText !== undefined) {
            box.alternativeText = alternativeText;
        }
        if (running !== undefined) {
            box.runningName = running;
        }
        // The link of an element that an image format styles comes from that style, which the document's cascade did not give.
        const link: string | undefined = pseudoElement === undefined && this.images.ownsElement(element) ? this.cascade.linkValue(element, style.values[PropertyTable.LINK])
            : this.cascade.linkOf(element, pseudoElement, style.values[PropertyTable.LINK]);
        if (link !== undefined) {
            const destination: string | undefined = this.references.link(link, this.cascade.linkTarget(link));
            if (destination === undefined) {
                box.linkUri = link;
            } else {
                box.linkDestination = destination;
            }
        }
        if (!replaced && this.isInlineBox(box)) {
            return this.splitInline(box, this.arranged(display, this.withRunIns(children, style, usedPage), style, usedPage));
        }
        this.fill(box, display, children);
        return [!replaced && this.displays.isTableRoot(used) ? this.tables.wrap(box) : box];
    }

    private fill(box: ElementBox, display: DisplayType, children: ReadonlyArray<BoxNode>): void {
        // The anonymous boxes that the display type of the element asks for around its contents.
        const style: ComputedStyle = box.style;
        let content: ReadonlyArray<BoxNode> = box.replaced ? children : this.arranged(display, this.withRunIns(children, style, box.usedPage), style, box.usedPage);
        if (!box.replaced && this.displays.isRubyContainer(display) && display.outer !== "inline") {
            content = [this.ruby.container(content, style, box.usedPage)];
        }
        box.children = !box.replaced && this.displays.isBlockContainer(box.display) ? this.blockContainerChildren(content, style, box.usedPage) : [...content];
        this.tables.pageValues(box);
    }

    private withRunIns(children: ReadonlyArray<BoxNode>, style: ComputedStyle, usedPage: string): ReadonlyArray<BoxNode> {
        // CSS Display 3 §5: "This fixup occurs before the anonymous block and inline box fixup". A run-in sequence is "a
        // maximal sequence of consecutive sibling run-in boxes and intervening white space and/or out-of-flow boxes".
        if (!children.some((child: BoxNode) => this.isRunIn(child))) {
            return children;
        }
        const result: Array<BoxNode> = [];
        let index: number = 0;
        while (index < children.length) {
            if (!this.isRunIn(children[index])) {
                result.push(children[index]);
                index++;
                continue;
            }
            let end: number = index + 1;
            for (let scan: number = end; scan < children.length; scan++) {
                const node: BoxNode = children[scan];
                if (this.isRunIn(node)) {
                    end = scan + 1;
                } else if (!(node.kind === "text" && SelectorMatcher.WHITESPACE_ONLY.test(node.text)) && !(node.kind === "box" && node.placement !== "in-flow")) {
                    break;
                }
            }
            // White space that collapses away between the sequence and a block makes no box, so the block still follows it.
            let next: number = end;
            while (next < children.length && children[next].kind === "text" && this.collapsesAway(children[next] as TextSequence)) {
                next++;
            }
            const follower: BoxNode | undefined = children[next];
            if (follower !== undefined && this.isFlowBlock(follower)) {
                this.insertRunIns(follower, children.slice(index, end));
                index = end;
                continue;
            }
            // "Otherwise [...] an anonymous block box is generated around the run-in sequence and all immediately following
            // inline-level content (up to, but not including, the next run-in sequence, if any)."
            let stop: number = end;
            while (stop < children.length && !this.isRunIn(children[stop]) && !this.isInFlowBlockLevel(children[stop])) {
                stop++;
            }
            result.push(this.anonymousBlock(children.slice(index, stop), style, usedPage));
            index = stop;
        }
        return result;
    }

    private insertRunIns(block: ElementBox, sequence: Array<BoxNode>): void {
        // CSS Display 3 §5: the sequence goes into the block "after its ::marker pseudo-element's boxes (if any), but
        // preceding any other boxes", and "This re-parenting recurses if possible", down to the deepest first paragraph.
        let target: ElementBox = block;
        let position: number = 0;
        for (; ;) {
            position = 0;
            while (position < target.children.length && this.isMarkerBox(target.children[position])) {
                position++;
            }
            const first: BoxNode | undefined = target.children[position];
            if (first === undefined || !this.isFlowBlock(first)) {
                break;
            }
            target = first;
        }
        // The block was built before its run-ins came, so where it holds block-level boxes they get the anonymous block box
        // that inline-level content has among them.
        const wrapped: boolean = target.children.some((child: BoxNode) => this.isInFlowBlockLevel(child));
        target.children.splice(position, 0, ...(wrapped ? [this.anonymousBlock(sequence, target.style, target.usedPage)] : sequence));
    }

    private isRunIn(node: BoxNode): boolean {
        return node.kind === "box" && node.placement === "in-flow" && node.display.outer === "run-in" && node.display.internal === undefined;
    }

    private isMarkerBox(node: BoxNode): boolean {
        return node.kind === "box" && node.pseudoElement !== undefined && node.pseudoElement.endsWith("marker");
    }

    private isFlowBlock(node: BoxNode): node is ElementBox {
        // CSS Display 3 §5: "a block box that does not establish a new block formatting context"; CSS Overflow 3 §3, CSS
        // Multi-column 1 §2, CSS Containment 2 §3 and CSS Conditional 5 §5.1 name the properties that make a block box establish one.
        if (node.kind !== "box" || node.placement !== "in-flow" || node.replaced || node.display.outer !== "block" || node.display.inner !== "flow"
            || node.display.internal !== undefined || (this.displays.containment(node.style.values, node.display, false) & OWN_CONTEXT) !== 0) {
            return false;
        }
        return SAME_CONTEXT.every(([property, keywords]: readonly [string, ReadonlyArray<string>]) => {
            const value: CssValue | undefined = node.style.values[property];
            return value === undefined || (value.kind === "ident" && keywords.includes(value.lower));
        });
    }

    private arranged(display: DisplayType, children: ReadonlyArray<BoxNode>, style: ComputedStyle, usedPage: string): ReadonlyArray<BoxNode> {
        // The anonymous boxes of CSS Tables 3 §2.2.1 come first: CSS Ruby 1 §2.2 takes misparented table boxes as the
        // inline-level content that their anonymous inline table makes of them.
        const content: ReadonlyArray<BoxNode> = this.ruby.arrange(display, this.tables.arrange(display, children, style, usedPage), style, usedPage);
        return this.displays.isItemContainer(display) ? this.items(content, style, usedPage) : content;
    }

    private items(children: ReadonlyArray<BoxNode>, style: ComputedStyle, usedPage: string): Array<BoxNode> {
        // CSS Flexbox 1 §4 and CSS Grid 2 §6: "each child text sequence is wrapped in an anonymous block container" item, and
        // one that "contains only white space ... is instead not rendered (just as if its text nodes were display:none)".
        const result: Array<BoxNode> = [];
        let run: Array<BoxNode> = [];
        const flush: () => void = (): void => {
            if (run.some((node: BoxNode) => node.kind !== "text" || !SelectorMatcher.WHITESPACE_ONLY.test(node.text))) {
                result.push(this.anonymousBlock(run, style, usedPage));
            }
            run = [];
        };
        for (const child of children) {
            if (child.kind === "box") {
                flush();
                result.push(child);
            } else {
                run.push(child);
            }
        }
        flush();
        return result;
    }

    private anonymousBlock(children: Array<BoxNode>, style: ComputedStyle, usedPage: string): ElementBox {
        const box: ElementBox = {
            kind: "box", style: this.anonymousStyle(style), display: ANONYMOUS_BLOCK, placement: "in-flow",
            replaced: false, hasStartEdge: true, hasEndEdge: true, usedPage, startPage: usedPage, endPage: usedPage, children
        };
        this.tables.pageValues(box);
        return box;
    }

    private alternativeText(style: ComputedStyle, state: ContentState): string | undefined {
        // CSS Content 3 §1.2: the alternative text after the slash "must be used for speech output instead" of the content.
        const items: Array<CssValue> | undefined = this.contentValues.alternative(style.values["content"]);
        return items === undefined ? undefined : this.content.alternativeText(items, style, state);
    }

    private anonymousStyle(style: ComputedStyle): ComputedStyle {
        // CSS 2.1 §9.2.1.1 and CSS Display 3 §2: anonymous boxes and text inherit from their parent box; their other properties
        // have the initial value. CSS Viewport 1 (Editor's Draft) §4: they have the effective zoom of their parent.
        const anonymous: ComputedStyle = { values: style.inherited, inherited: style.inherited, custom: style.custom };
        if (style.zoom !== undefined) {
            anonymous.zoom = style.zoom;
        }
        return anonymous;
    }

    private blockContainerChildren(children: ReadonlyArray<BoxNode>, style: ComputedStyle, usedPage: string): Array<BoxNode> {
        // CSS 2.1 §9.2.1.1: a block container with a block-level box inside holds only block-level boxes, so each run of
        // inline-level content goes into an anonymous block box; §9.2.2.1: white space that would collapse away makes no box.
        if (!children.some((child: BoxNode) => this.isInFlowBlockLevel(child))) {
            return [...children];
        }
        const own: (child: BoxNode) => boolean = (child: BoxNode): boolean => this.isInFlowBlockLevel(child);
        const result: Array<BoxNode> = [];
        let run: Array<BoxNode> = [];
        const flush: () => void = (): void => {
            if (run.some((node: BoxNode) => this.isInlineContent(node))) {
                result.push(this.anonymousBlock(run, style, usedPage));
            } else {
                result.push(...run.filter((node: BoxNode) => node.kind === "box"));
            }
            run = [];
        };
        for (const child of children) {
            if (own(child)) {
                flush();
                result.push(child);
            } else {
                run.push(child);
            }
        }
        flush();
        return result;
    }

    private splitInline(box: ElementBox, children: ReadonlyArray<BoxNode>): Array<BoxNode> {
        // CSS 2.1 §9.2.1.1: the inline box is broken around "any block-level siblings that are consecutive or separated only by
        // collapsible whitespace and/or out-of-flow elements", into two boxes "even if either side is empty".
        if (!children.some((child: BoxNode) => this.isInFlowBlockLevel(child))) {
            box.children = [...children];
            this.tables.pageValues(box);
            return [box];
        }
        const parts: Array<BoxNode> = [];
        let current: Array<BoxNode> = [];
        let grouped: boolean = false;
        const part: (last: boolean) => ElementBox = (last: boolean): ElementBox => ({
            ...box, hasStartEdge: parts.length === 0, hasEndEdge: last, children: current
        });
        for (const child of children) {
            if (this.isInFlowBlockLevel(child)) {
                if (grouped) {
                    parts.push(...current);
                } else {
                    parts.push(part(false));
                }
                parts.push(child);
                current = [];
                grouped = true;
            } else {
                current.push(child);
                grouped = grouped && this.separates(child);
            }
        }
        parts.push(part(true));
        return parts;
    }

    private separates(node: BoxNode): boolean {
        return node.kind === "box" ? node.placement !== "in-flow" : node.kind === "text" && this.collapsesAway(node);
    }

    private usedPage(style: ComputedStyle, inherited: string): string {
        // CSS Paged Media 3 §8.1: auto takes the value of the nearest ancestor with another value, and the empty string on the root.
        const page: CssValue | undefined = style.values["page"];
        return page !== undefined && page.kind === "ident" && page.lower !== "auto" ? page.name : inherited;
    }

    private placement(style: ComputedStyle, parent?: Context): Placement {
        // GCPM 3 §1.2.1 and §2.2 take running and footnote elements out of the flow; CSS 2.1 §9.3 and §9.5 do the same for
        // absolutely positioned and floating boxes.
        const position: CssValue | undefined = style.values["position"];
        const float: CssValue | undefined = style.values["float"];
        if (position !== undefined && position.kind === "function" && position.name === "running") {
            return "running";
        }
        if (position !== undefined && position.kind === "ident" && (position.lower === "absolute" || position.lower === "fixed")) {
            return position.lower === "absolute" ? "absolute" : "fixed";
        }
        // CSS Flexbox 1 §3: "float and clear do not create floating or clearance of flex item, and do not take it out-of-flow";
        // CSS Grid 2 §5.1: "float and clear have no effect on a grid item".
        if (float === undefined || (float.kind === "ident" && float.lower === "none") || this.isItem(parent)) {
            return "in-flow";
        }
        return float.kind === "ident" && float.lower === "footnote" ? "footnote" : "float";
    }

    private isItem(parent?: Context): boolean {
        // CSS Display 3 §2.5: an element with display: contents has no box, so its children are children of the box above it.
        for (let context: Context | undefined = parent; context !== undefined; context = context.parent) {
            const display: DisplayType = this.displays.parse(context.style.values["display"]);
            if (display.box !== "contents") {
                return this.displays.isItemContainer(display);
            }
        }
        return false;
    }

    private runningName(style: ComputedStyle): string | undefined {
        const position: CssValue | undefined = style.values["position"];
        if (position === undefined || position.kind !== "function" || position.name !== "running") {
            return undefined;
        }
        const argument: CssValue | undefined = position.args[0];
        return argument !== undefined && argument.kind === "ident" ? argument.name : undefined;
    }

    private isInlineBox(box: ElementBox): boolean {
        return box.placement === "in-flow" && this.displays.isInlineBox(box.display);
    }

    private isInFlowBlockLevel(node: BoxNode): boolean {
        return node.kind === "box" && node.placement === "in-flow" && node.display.outer === "block";
    }

    private isInlineContent(node: BoxNode): boolean {
        if (node.kind === "box") {
            return node.placement === "in-flow";
        }
        return node.kind === "deferred" || !this.collapsesAway(node);
    }

    private collapsesAway(text: TextSequence): boolean {
        // CSS Text 4 §4.1: with white-space-collapse collapse or discard, document white space collapses away at line edges;
        // preserve-breaks keeps segment breaks, §4 makes a carriage return a space; string() is empty only until its page is known.
        if (text.named !== undefined || !SelectorMatcher.WHITESPACE_ONLY.test(text.text)) {
            return false;
        }
        const collapse: CssValue | undefined = text.style.values["white-space-collapse"];
        const mode: string = collapse !== undefined && collapse.kind === "ident" ? collapse.lower : "collapse";
        return mode === "collapse" || mode === "discard" || (mode === "preserve-breaks" && !SEGMENT_BREAK.test(text.text));
    }
}
