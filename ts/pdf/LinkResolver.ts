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
import type { CssValue } from "../css/values/CssValue.js";
import { SourceElement } from "../parse/SourceElement.js";
import { BaseUrls } from "./BaseUrls.js";
import type { Cascade } from "./Cascade.js";
import type { ComputedStyle } from "./ComputedStyle.js";
import { SelectorMatcher } from "./SelectorMatcher.js";
import { StyleComputer } from "./StyleComputer.js";

const PERCENT: RegExp = /%/g;
const PATH_SEPARATOR: string = "/";
const WHITE_SPACE: RegExp = /[ \t\r\n]+/g;

export class LinkResolver {

    static readonly PROPERTY: string = PropertyTable.LINK;
    static readonly HEADING: string = "bookmark-level";

    private readonly cascade: Cascade;
    private readonly computer: StyleComputer;
    private readonly root: SourceElement;
    private readonly documentUri?: string;
    private readonly bases?: BaseUrls;
    private readonly styles: WeakMap<SourceElement, ComputedStyle> = new WeakMap<SourceElement, ComputedStyle>();
    private readonly targets: WeakMap<SourceElement, string | null> = new WeakMap<SourceElement, string | null>();
    private ids?: Map<string, Array<SourceElement>>;
    private texts?: Map<string, SourceElement | null>;

    constructor(cascade: Cascade, computer: StyleComputer, root: SourceElement, documentUri?: string) {
        this.cascade = cascade;
        this.computer = computer;
        this.root = root;
        if (documentUri !== undefined) {
            this.documentUri = documentUri;
            this.bases = new BaseUrls(documentUri);
        }
    }

    isLink(element: SourceElement): boolean {
        // Selectors 4 §8.1: a link is the source anchor of a hyperlink; here, an element whose link property is not none.
        return this.linkValue(element) !== null;
    }

    isLocal(element: SourceElement, levels?: number): boolean {
        // Selectors 5 §2.1: the target's absolute URL without fragment against the document's URL; with a number, the origin and
        // that many path segments, and a segment missing from the document's URL matches nothing.
        const link: string | null = this.targetOf(element);
        if (link === null || this.documentUri === undefined) {
            return false;
        }
        let target: URL;
        let document: URL;
        try {
            target = new URL(link);
            document = new URL(this.documentUri);
        } catch {
            return false;
        }
        if (levels === undefined) {
            target.hash = "";
            document.hash = "";
            return target.href === document.href;
        }
        if (target.protocol !== document.protocol || target.host !== document.host) {
            return false;
        }
        const documentSegments: Array<string> = document.pathname.split("/").filter((segment: string) => segment.length > 0);
        const targetSegments: Array<string> = target.pathname.split("/").filter((segment: string) => segment.length > 0);
        if (documentSegments.length < levels) {
            return false;
        }
        for (let index: number = 0; index < levels; index++) {
            if (documentSegments[index] !== targetSegments[index]) {
                return false;
            }
        }
        return true;
    }

    targetOf(element: SourceElement): string | null {
        let target: string | null | undefined = this.targets.get(element);
        if (target === undefined) {
            const value: CssValue | null = this.linkValue(element);
            target = value === null ? null : (this.target(value, element) ?? null);
            this.targets.set(element, target);
        }
        return target;
    }

    pseudoTarget(element: SourceElement, value?: CssValue): string | undefined {
        return value === undefined || (value.kind === "ident" && value.lower === "none") ? undefined : this.target(value, element);
    }

    element(url: string): SourceElement | undefined {
        const hash: number = url.indexOf("#");
        if (this.documentUri === undefined || hash < 0 || url.substring(0, hash) !== this.documentUri) {
            return undefined;
        }
        const fragment: string = BaseUrls.percentDecoded(url.substring(hash + 1)).toString("utf8");
        if (this.elementsWith(fragment) !== undefined) {
            return undefined;
        }
        return (fragment.includes(PATH_SEPARATOR) ? this.along(fragment.split(PATH_SEPARATOR), 0) : undefined) ?? this.elementWithText(fragment);
    }

    private named(reference: string): string | undefined {
        if (this.documentUri === undefined || reference.includes("#") || URL.canParse(reference)
            || (this.elementsWith(reference) === undefined && this.elementWithText(reference) === undefined)) {
            return undefined;
        }
        const url: URL = new URL(this.documentUri);
        url.hash = reference.replace(PERCENT, "%25");
        return url.href;
    }

    private elementWithText(name: string): SourceElement | undefined {
        const text: string = name.replace(WHITE_SPACE, " ").trim();
        const known: SourceElement | null | undefined = this.texts?.get(text);
        if (known !== undefined) {
            return known ?? undefined;
        }
        let found: SourceElement | undefined;
        const pending: Array<SourceElement> = [this.root];
        while (found === undefined && pending.length > 0) {
            const element: SourceElement = pending.pop() as SourceElement;
            if (text.length > 0 && this.textOf(element, "", text.length)?.trim() === text && this.isHeading(element)) {
                found = element;
            }
            const children: Array<SourceElement> = element.getChildren();
            for (let child: number = children.length - 1; child >= 0; child--) {
                pending.push(children[child]);
            }
        }
        this.texts = this.texts ?? new Map<string, SourceElement | null>();
        this.texts.set(text, found ?? null);
        return found;
    }

    private isHeading(element: SourceElement): boolean {
        const level: CssValue | undefined = this.style(element).values[LinkResolver.HEADING];
        return level !== undefined && level.kind === "number";
    }

    private textOf(element: SourceElement, before: string, limit: number): string | undefined {
        let text: string = before;
        for (const child of element.getContent()) {
            if (child instanceof TextNode) {
                text = (text + child.getValue()).replace(WHITE_SPACE, " ");
            } else if (child instanceof SourceElement) {
                const inner: string | undefined = this.textOf(child, text, limit);
                if (inner === undefined) {
                    return undefined;
                }
                text = inner;
            }
            if (text.trimStart().length > limit + 1) {
                return undefined;
            }
        }
        return text;
    }

    private along(steps: ReadonlyArray<string>, index: number, within?: SourceElement): SourceElement | undefined {
        if (index === steps.length) {
            return within;
        }
        // An ID can be on more than one element, and the first one may not hold the rest of the path (a map entry and the
        // topic it names), so every element with the ID is tried in document order.
        for (const candidate of this.elementsWith(steps[index]) ?? []) {
            const found: SourceElement | undefined = within === undefined || this.holds(within, candidate) ? this.along(steps, index + 1, candidate) : undefined;
            if (found !== undefined) {
                return found;
            }
        }
        return undefined;
    }

    private holds(ancestor: SourceElement, element: SourceElement): boolean {
        for (let current: SourceElement | undefined = element.getParent(); current !== undefined; current = current.getParent()) {
            if (current === ancestor) {
                return true;
            }
        }
        return false;
    }

    private elementsWith(id: string): ReadonlyArray<SourceElement> | undefined {
        if (this.ids === undefined) {
            const ids: Map<string, Array<SourceElement>> = new Map<string, Array<SourceElement>>();
            const pending: Array<SourceElement> = [this.root];
            while (pending.length > 0) {
                const element: SourceElement = pending.pop() as SourceElement;
                for (const name of SelectorMatcher.ID_ATTRIBUTES) {
                    const value: string | undefined = element.getAttributeValue(name);
                    const known: Array<SourceElement> | undefined = value === undefined ? undefined : ids.get(value);
                    if (value !== undefined && known === undefined) {
                        ids.set(value, [element]);
                    } else if (known !== undefined && known[known.length - 1] !== element) {
                        known.push(element);
                    }
                }
                const children: Array<SourceElement> = element.getChildren();
                for (let child: number = children.length - 1; child >= 0; child--) {
                    pending.push(children[child]);
                }
            }
            this.ids = ids;
        }
        return this.ids.get(id);
    }

    private linkValue(element: SourceElement): CssValue | null {
        const value: CssValue | undefined = this.style(element).values[LinkResolver.PROPERTY];
        return value === undefined || (value.kind === "ident" && value.lower === "none") ? null : value;
    }

    private style(element: SourceElement): ComputedStyle {
        // The link property and the custom properties computed from the cascade without the link pseudo-classes; link values
        // are strings and URLs, which no viewport unit reaches, so no page area is needed.
        let style: ComputedStyle | undefined = this.styles.get(element);
        if (style === undefined) {
            const parent: SourceElement | undefined = element.getParent();
            style = this.computer.compute(StyleComputer.input(this.cascade.linkDeclarations(element), { width: 0, height: 0 }, StyleComputer.NO_CONTAINERS,
                parent === undefined ? undefined : this.style(parent), undefined, element));
            this.styles.set(element, style);
        }
        return style;
    }

    private target(value: CssValue, element: SourceElement): string | undefined {
        // The values joined in order form the target, as "#" attr(linkend) does; a url() was already resolved against the
        // stylesheet, and the joined text is resolved against the base of the element, which is the document's URL or its xml:base.
        let reference: string = "";
        for (const item of value.kind === "list" ? value.items : [value]) {
            if (item.kind === "url") {
                reference += item.href;
            } else if (item.kind === "string") {
                reference += item.value;
            } else {
                return undefined;
            }
        }
        const named: string | undefined = this.named(reference);
        if (named !== undefined) {
            return named;
        }
        if (this.bases !== undefined) {
            return this.bases.resolve(reference, element);
        }
        try {
            return new URL(reference).href;
        } catch {
            return undefined;
        }
    }
}
