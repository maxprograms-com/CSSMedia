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
import type { CssValue } from "../css/values/CssValue.js";
import { SourceElement } from "../parse/SourceElement.js";
import { BaseUrls } from "./BaseUrls.js";
import type { BoxNode, ElementBox } from "./BoxTree.js";
import type { Cascade } from "./Cascade.js";
import type { Counter, CounterSet } from "./CounterScopes.js";
import { GeneratedContent } from "./GeneratedContent.js";
import { SelectorMatcher } from "./SelectorMatcher.js";
import { WhiteSpaceProcessor } from "./WhiteSpaceProcessor.js";

interface Target {
    counters?: CounterSet;
    texts?: Readonly<Record<string, string>>;
}

const LEADING_WHITE_SPACE: RegExp = /^[ \t\r\n]*/;
const BOOKMARK_PREFIX: string = "bookmark-";

export class CrossReferences {

    readonly diagnostics: Array<string> = [];
    private readonly documentUri: string;
    private readonly everyId: boolean;
    private readonly cascade: Cascade;
    private readonly requested: Set<string> = new Set<string>();
    private readonly pageIds: Set<string> = new Set<string>();
    private readonly linkIds: Set<string> = new Set<string>();
    private readonly anchors: Map<SourceElement, Array<string>> = new Map<SourceElement, Array<string>>();
    private readonly bookmarked: Map<SourceElement | ElementBox, string | undefined> = new Map<SourceElement | ElementBox, string | undefined>();
    private bookmarkNames: number = 0;
    private readonly targets: Map<string, Target> = new Map<string, Target>();
    private readonly shown: Map<string, number> = new Map<string, number>();
    private readonly found: Map<string, number> = new Map<string, number>();
    private readonly moves: Set<string> = new Set<string>();
    private root?: ElementBox;
    private whiteSpace?: WhiteSpaceProcessor;

    constructor(documentUri: string, everyId: boolean, cascade: Cascade) {
        this.documentUri = documentUri;
        this.everyId = everyId;
        this.cascade = cascade;
    }

    get showsPages(): boolean {
        return this.pageIds.size > 0;
    }

    get recording(): boolean {
        return this.everyId || this.pageIds.size > 0;
    }

    get moved(): boolean {
        return this.moves.size > 0;
    }

    target(value?: CssValue): string | undefined {
        // CSS Content 3 §2.6.1: these functions "only take a fragment URL which points to a location in the current document";
        // anything else "the user agent must treat that as an error", which shows nothing.
        const reference: string | undefined = value === undefined ? undefined : (value.kind === "url" ? value.href : (value.kind === "string" ? value.value : undefined));
        const hash: number = reference === undefined ? -1 : reference.indexOf("#");
        if (reference === undefined || hash < 0 || (hash > 0 && reference.substring(0, hash) !== this.documentUri)) {
            this.report("The cross-reference " + (reference ?? "") + " does not point to an element of the document, so it shows nothing");
            return undefined;
        }
        const id: string = BaseUrls.percentDecoded(reference.substring(hash + 1)).toString("utf8");
        this.requested.add(id);
        return id;
    }

    link(url: string, target?: SourceElement): string | undefined {
        const hash: number = url.indexOf("#");
        if (hash < 0 || url.substring(0, hash) !== this.documentUri) {
            return undefined;
        }
        const name: string = BaseUrls.percentDecoded(url.substring(hash + 1)).toString("utf8");
        this.linkIds.add(name);
        const names: Array<string> | undefined = target === undefined ? undefined : this.anchors.get(target);
        if (target !== undefined && names === undefined) {
            this.anchors.set(target, [name]);
        } else if (names !== undefined && !names.includes(name)) {
            names.push(name);
        }
        return name;
    }

    bookmark(target: SourceElement | ElementBox): void {
        if (!this.bookmarked.has(target)) {
            this.bookmarked.set(target, undefined);
        }
    }

    bookmarkName(target: SourceElement | ElementBox): string | undefined {
        return this.bookmarked.get(target);
    }

    destinations(box: ElementBox): ReadonlyArray<string> | undefined {
        if ((this.linkIds.size === 0 && this.bookmarked.size === 0) || box.pseudoElement !== undefined) {
            return undefined;
        }
        const id: string | undefined = this.idOf(box);
        const names: Array<string> = id !== undefined && this.linkIds.has(id) ? [id] : [];
        for (const name of (box.element === undefined ? undefined : this.anchors.get(box.element)) ?? []) {
            if (!names.includes(name)) {
                names.push(name);
            }
        }
        const target: SourceElement | ElementBox = box.element ?? box;
        if (this.bookmarked.has(target)) {
            names.push(this.anchorName(target));
        }
        return names.length === 0 ? undefined : names;
    }

    anchorName(target: SourceElement | ElementBox): string {
        // A name is given after the build has met every link, so that none is a fragment that a link names.
        let name: string | undefined = this.bookmarked.get(target);
        while (name === undefined || this.linkIds.has(name)) {
            name = BOOKMARK_PREFIX + ++this.bookmarkNames;
        }
        this.bookmarked.set(target, name);
        return name;
    }

    reportLinks(has: (name: string) => boolean): void {
        for (const name of this.linkIds) {
            if (!has(name)) {
                this.report("No element of the document that the fragment #" + name + " names is laid out, so the links to it go nowhere");
            }
        }
    }

    showPage(id: string): void {
        this.pageIds.add(id);
    }

    page(id: string): number | undefined {
        return this.shown.get(id);
    }

    counters(id: string, name: string): Array<number> | undefined {
        const counters: CounterSet | undefined = this.lookup(id)?.counters;
        return counters?.filter((counter: Counter) => counter.name === name).map((counter: Counter) => counter.value);
    }

    text(id: string, kind: string): string | undefined {
        return this.lookup(id)?.texts?.[kind];
    }

    collect(root: ElementBox): boolean {
        // CSS Content 3 §2.6: the counters and texts of a target follow document order, so the box tree gives them.
        this.root = root;
        if (this.requested.size === 0) {
            return false;
        }
        const pending: Set<string> = new Set<string>(this.requested);
        const found: Map<string, Target> = new Map<string, Target>();
        this.visit(root, pending, found);
        for (const id of pending) {
            this.report("No element of the document has the ID " + id + ", so the cross-references to it show nothing");
            found.set(id, {});
        }
        let changed: boolean = false;
        for (const [id, target] of found) {
            const known: Target | undefined = this.targets.get(id);
            if (known === undefined || JSON.stringify(known.counters) !== JSON.stringify(target.counters) || JSON.stringify(known.texts) !== JSON.stringify(target.texts)) {
                changed = true;
            }
            this.targets.set(id, target);
        }
        return changed;
    }

    private lookup(id: string): Target | undefined {
        let target: Target | undefined = this.targets.get(id);
        if (target === undefined && this.root !== undefined) {
            const found: Map<string, Target> = new Map<string, Target>();
            this.visit(this.root, new Set<string>([id]), found);
            target = found.get(id) ?? {};
            this.targets.set(id, target);
        }
        return target;
    }

    startLayout(): void {
        this.found.clear();
        this.moves.clear();
    }

    recordPage(box: ElementBox, page: number): void {
        this.recordName(this.idOf(box), page);
        if (this.bookmarked.size > 0) {
            this.recordName(this.bookmarked.get(box.element ?? box), page);
        }
        if (this.anchors.size > 0 && box.element !== undefined && box.pseudoElement === undefined) {
            for (const name of this.anchors.get(box.element) ?? []) {
                this.recordName(name, page);
            }
        }
    }

    private recordName(id: string | undefined, page: number): void {
        // §2.6.1: the page counter of a target is that of the page where its box starts.
        if (id === undefined || this.found.has(id) || (!this.everyId && !this.pageIds.has(id))) {
            return;
        }
        this.found.set(id, page);
        if (this.pageIds.has(id) && this.shown.get(id) !== page) {
            this.moves.add(id);
        }
    }

    finishLayout(): boolean {
        let changed: boolean = false;
        for (const [id, page] of this.found) {
            if (this.shown.get(id) !== page) {
                changed = changed || this.pageIds.has(id);
                this.shown.set(id, page);
            }
        }
        return changed;
    }

    reportMoved(): void {
        for (const id of this.moves) {
            this.report("The page of the element with the ID " + id + " changed again in the last layout, so its cross-references can show another page");
        }
    }

    private report(message: string): void {
        if (!this.diagnostics.includes(message)) {
            this.diagnostics.push(message);
        }
    }

    private visit(box: ElementBox, pending: Set<string>, found: Map<string, Target>): void {
        const element: SourceElement | undefined = box.pseudoElement === undefined ? box.element : undefined;
        if (element !== undefined) {
            this.take(box, this.idOf(box), pending, found);
            this.take(box, this.bookmarked.get(element), pending, found);
            for (const name of this.anchors.get(element) ?? []) {
                this.take(box, name, pending, found);
            }
            if (pending.size === 0) {
                return;
            }
        }
        for (const child of box.children) {
            if (child.kind === "box" && pending.size > 0) {
                this.visit(child, pending, found);
            }
        }
    }

    private take(box: ElementBox, id: string | undefined, pending: Set<string>, found: Map<string, Target>): void {
        if (id === undefined || !pending.has(id)) {
            return;
        }
        pending.delete(id);
        const target: Target = { texts: this.texts(box) };
        if (box.counterState !== undefined) {
            target.counters = box.counterState.map((counter: Counter): Counter => ({ ...counter }));
        }
        found.set(id, target);
    }

    private idOf(box: ElementBox): string | undefined {
        const element: SourceElement | undefined = box.element;
        if (element === undefined) {
            return undefined;
        }
        for (const name of SelectorMatcher.ID_ATTRIBUTES) {
            const value: string | undefined = element.getAttributeValue(name);
            if (value !== undefined) {
                return value;
            }
        }
        return undefined;
    }

    private texts(box: ElementBox): Record<string, string> {
        // GCPM 3 §1.1.1.1: the string values are taken "as if white-space: normal had been set".
        const whiteSpace: WhiteSpaceProcessor = this.whiteSpace = this.whiteSpace ?? new WhiteSpaceProcessor();
        const element: string = whiteSpace.normalText(this.elementText(box.element as SourceElement), box.style);
        const before: string = whiteSpace.normalText(this.pseudoText(box, "before"), box.style);
        const after: string = whiteSpace.normalText(this.pseudoText(box, "after"), box.style);
        const whole: string = before + element;
        const start: number = (LEADING_WHITE_SPACE.exec(whole) as RegExpExecArray)[0].length;
        const letter: readonly [number, number, number] | undefined = GeneratedContent.firstLetter(whole, start, this.cascade.languageOf(box.element as SourceElement));
        return { content: element, before, after, "first-letter": letter === undefined ? "" : whole.substring(start, letter[2]) };
    }

    private elementText(element: SourceElement): string {
        let text: string = "";
        for (const child of element.getContent()) {
            if (child instanceof TextNode) {
                text += child.getValue();
            } else if (child instanceof SourceElement) {
                text += this.elementText(child);
            }
        }
        return text;
    }

    private pseudoText(box: ElementBox, name: string): string {
        const pseudo: BoxNode | undefined = box.children.find((child: BoxNode) => child.kind === "box" && child.pseudoElement === name);
        return pseudo === undefined ? "" : this.boxText(pseudo);
    }

    private boxText(node: BoxNode): string {
        if (node.kind === "text") {
            return node.text;
        }
        return node.kind === "box" ? node.children.map((child: BoxNode) => this.boxText(child)).join("") : "";
    }
}
