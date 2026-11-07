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

import type { BoxNode, ElementBox } from "./BoxTree.js";
import type { ComputedStyle } from "./ComputedStyle.js";
import type { DisplayType } from "./DisplayTypes.js";

const RUBY: string = "ruby";
const BASE: string = "ruby-base";
const TEXT: string = "ruby-text";
const BASE_CONTAINER: string = "ruby-base-container";
const TEXT_CONTAINER: string = "ruby-text-container";
const WHITE_SPACE: RegExp = /^[ \t\r\n]*$/;
const RUBY_DISPLAY: DisplayType = {outer: "inline", inner: "ruby", listItem: false };
const BASE_DISPLAY: DisplayType = { internal:BASE, outer: "inline", inner: "flow", listItem: false };
const TEXT_DISPLAY: DisplayType = { internal:TEXT, outer: "inline", inner: "flow", listItem: false };
const BASE_CONTAINER_DISPLAY: DisplayType = { internal:BASE_CONTAINER, outer: "inline", inner: "ruby", listItem: false };
const TEXT_CONTAINER_DISPLAY: DisplayType = { internal:TEXT_CONTAINER, outer: "inline", inner: "ruby", listItem: false };

export class RubyBoxes {

    arrange(display: DisplayType, children: ReadonlyArray<BoxNode>, style: ComputedStyle, usedPage: string): ReadonlyArray<BoxNode> {
        // CSS Ruby 1 §2.2: the children of a box with this display type, with the anonymous ruby boxes they need.
        const role: string | undefined = this.roleOf(display);
        if (role === undefined && !children.some((child: BoxNode) => this.internalOf(child) !== undefined)) {
            return children;
        }
        const nodes: Array<BoxNode> = this.wrapImproper(children, style, usedPage, role);
        return role === RUBY || role === BASE_CONTAINER || role === TEXT_CONTAINER ? this.structure(role, nodes, style, usedPage) : nodes;
    }

    container(children: ReadonlyArray<BoxNode>, style: ComputedStyle, usedPage: string): ElementBox {
        // CSS Ruby 1 §2.1.2: an element with a ruby inner type and another outer type than inline generates "a principal box of
        // the required outer display type type, and an inline-level ruby container".
        return this.anonymous(RUBY_DISPLAY, this.inherited(style), usedPage, [...children]);
    }

    private roleOf(display: DisplayType): string | undefined {
        if (display.box !== undefined) {
            return undefined;
        }
        if (display.internal !== undefined) {
            return display.internal.startsWith("ruby-") ? display.internal : undefined;
        }
        return display.inner === "ruby" ? RUBY : undefined;
    }

    private internalOf(node: BoxNode): string | undefined {
        const internal: string | undefined = node.kind === "box" && node.placement === "in-flow" ? node.display.internal : undefined;
        return internal !== undefined && internal.startsWith("ruby-") ? internal : undefined;
    }

    private isProper(internal: string, role?: string): boolean {
        // "an improperly-contained ruby base is one not parented by a ruby base container or ruby container", an annotation
        // one not parented by an annotation container or ruby container, and a level container one not parented by a ruby container.
        return role === RUBY || (internal === BASE && role === BASE_CONTAINER) || (internal === TEXT && role === TEXT_CONTAINER);
    }

    private isWhite(node: BoxNode): boolean {
        return node.kind === "text" && WHITE_SPACE.test(node.text);
    }

    private wrapImproper(children: ReadonlyArray<BoxNode>, style: ComputedStyle, usedPage: string, role?: string): Array<BoxNode> {
        // "Any consecutive sequence of improperly-contained ruby base containers, ruby annotation containers, ruby bases, and/or
        // ruby annotations (and any intervening white space) is wrapped in an anonymous ruby container."
        const result: Array<BoxNode> = [];
        let run: Array<BoxNode> = [];
        let pending: Array<BoxNode> = [];
        const flush: () => void = (): void => {
            if (run.length > 0) {
                const anonymous: ComputedStyle = this.inherited(style);
                result.push(this.anonymous(RUBY_DISPLAY, anonymous, usedPage, this.structure(RUBY, run, anonymous, usedPage)));
                run = [];
            }
            result.push(...pending);
            pending = [];
        };
        for (const child of children) {
            const internal: string | undefined = this.internalOf(child);
            if (internal !== undefined && !this.isProper(internal, role)) {
                run.push(...pending, child);
                pending = [];
            } else if (run.length > 0 && this.isWhite(child)) {
                pending.push(child);
            } else {
                flush();
                result.push(child);
            }
        }
        flush();
        return result;
    }

    private structure(role: string, children: ReadonlyArray<BoxNode>, style: ComputedStyle, usedPage: string): Array<BoxNode> {
        // "Any consecutive sequence of text and inline-level boxes directly parented by a ruby container or ruby base container
        // is wrapped in an anonymous ruby base", and in an annotation container "in an anonymous ruby annotation".
        const anonymous: ComputedStyle = this.inherited(style);
        const wrapper: DisplayType = role === TEXT_CONTAINER ? TEXT_DISPLAY : BASE_DISPLAY;
        const nodes: Array<BoxNode> = [];
        const white: Set<BoxNode> = new Set<BoxNode>();
        let run: Array<BoxNode> = [];
        const flush: () => void = (): void => {
            if (run.some((node: BoxNode) => node.kind !== "box" || node.placement === "in-flow")) {
                const box: ElementBox = this.anonymous(wrapper, anonymous, usedPage, run);
                // "if an anonymous box so constructed contains only white space, it is considered intra-ruby white space".
                if (run.every((node: BoxNode) => this.isWhite(node))) {
                    white.add(box);
                }
                nodes.push(box);
            } else {
                nodes.push(...run);
            }
            run = [];
        };
        for (const child of children) {
            if (this.internalOf(child) === undefined) {
                run.push(child);
            } else {
                flush();
                nodes.push(child);
            }
        }
        flush();
        const kept: Array<BoxNode> = this.interpretWhiteSpace(nodes, white);
        return role === RUBY ? this.levelContainers(kept, anonymous, usedPage) : kept;
    }

    private interpretWhiteSpace(nodes: ReadonlyArray<BoxNode>, white: ReadonlySet<BoxNode>): Array<BoxNode> {
        const removed: Set<BoxNode> = new Set<BoxNode>();
        let flow: Array<ElementBox> = nodes.filter((node: BoxNode): node is ElementBox => node.kind === "box" && node.placement === "in-flow");
        // "Any intra-ruby white space that is not the sole in-flow child of its parent and is the first or last in-flow child
        // of a ruby container, ruby annotation container, or ruby base container is removed".
        if (flow.length > 1) {
            for (const edge of [flow[0], flow[flow.length - 1]]) {
                if (white.has(edge)) {
                    removed.add(edge);
                }
            }
            flow = flow.filter((box: ElementBox) => !removed.has(box));
        }
        for (let index: number = 0; index < flow.length; index++) {
            const box: ElementBox = flow[index];
            if (!white.has(box)) {
                continue;
            }
            const before: string | undefined = flow[index - 1]?.display.internal;
            const after: string | undefined = flow[index + 1]?.display.internal;
            if (after === TEXT_CONTAINER || (after === TEXT && before !== TEXT)) {
                // Inter-level white space: before an annotation container, or between a box that is not an annotation and one.
                removed.add(box);
            } else if (before === BASE && after === BASE) {
                box.display = BASE_DISPLAY;
                box.rubyWhiteSpace = "inter-base";
            } else if (before === TEXT && after === TEXT) {
                box.display = TEXT_DISPLAY;
                box.rubyWhiteSpace = "inter-annotation";
            } else if (((before === TEXT || before === TEXT_CONTAINER) && (after === BASE || after === BASE_CONTAINER))
                || ((before === BASE || before === BASE_CONTAINER) && after === BASE_CONTAINER) || (before === BASE_CONTAINER && after === BASE)) {
                box.display = BASE_DISPLAY;
                box.rubyWhiteSpace = "inter-segment";
            }
        }
        return nodes.filter((node: BoxNode) => !removed.has(node));
    }

    private levelContainers(nodes: ReadonlyArray<BoxNode>, anonymous: ComputedStyle, usedPage: string): Array<BoxNode> {
        // "Any consecutive sequence of ruby bases and inter-base white space (and not inter-segment white space) not parented by
        // a ruby base container is wrapped in an anonymous ruby base container", and the annotations likewise.
        const result: Array<BoxNode> = [];
        let group: Array<BoxNode> = [];
        let level: string | undefined;
        const close: () => void = (): void => {
            if (group.length > 0) {
                result.push(this.anonymous(level === BASE ? BASE_CONTAINER_DISPLAY : TEXT_CONTAINER_DISPLAY, anonymous, usedPage, group));
                group = [];
            }
            level = undefined;
        };
        for (const node of nodes) {
            const internal: string | undefined = this.internalOf(node);
            const segment: boolean = node.kind === "box" && node.rubyWhiteSpace === "inter-segment";
            if ((internal === BASE && !segment) || internal === TEXT) {
                if (level !== internal) {
                    close();
                }
                level = internal;
                group.push(node);
            } else if (internal === undefined && level !== undefined) {
                // A box out of the flow stays where it is among the boxes of its level.
                group.push(node);
            } else {
                close();
                result.push(node);
            }
        }
        close();
        return result;
    }

    private inherited(style: ComputedStyle): ComputedStyle {
        // CSS Display 3 §2: an anonymous box inherits from its parent box, and its other properties have the initial value.
        return { values: style.inherited, inherited: style.inherited, custom: style.custom };
    }

    private anonymous(display: DisplayType, style: ComputedStyle, usedPage: string, children: Array<BoxNode>): ElementBox {
        return {
            kind: "box", style, display, placement: "in-flow", replaced: false,
            hasStartEdge: true, hasEndEdge: true, usedPage, startPage: usedPage, endPage: usedPage, children
        };
    }
}
