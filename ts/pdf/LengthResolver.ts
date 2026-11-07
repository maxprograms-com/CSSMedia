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

import type { CalcContext } from "../css/values/CalcSimplifier.js";
import { CalcSimplifier } from "../css/values/CalcSimplifier.js";
import type { CalcAnchor, CalcLeaf, CalcNode, CssValue } from "../css/values/CssValue.js";
import { CssUnits } from "../css/values/CssUnits.js";

export interface RelativeUnits {
    size(unit: string): number | undefined;
    absolute?(): number;
}

const PIXELS: string = "px";
const SIZE: string = "size";

export class LengthResolver {

    private readonly units: CssUnits = new CssUnits();
    private readonly simplifier: CalcSimplifier = new CalcSimplifier();

    compute(value: CssValue, relative: RelativeUnits): CssValue | undefined {
        // CSS Values 4 §6: a computed length is absolute; percentages stay percentages, and a calc() mixing both keeps both.
        switch (value.kind) {
            case "length":
            case "percentage":
                return value;
            case "number":
                return value.value === 0 ? { kind: "length", px: 0 } : undefined;
            case "dimension": {
                const px: number | undefined = this.pixels(value.value, value.unit, relative);
                return px === undefined ? undefined : { kind: "length", px };
            }
            case "calc":
                return this.computeCalc(value.root, relative);
            default:
                return undefined;
        }
    }

    pixelsOf(value: CssValue, relative: RelativeUnits, basis: number): number | undefined {
        // For the properties whose percentages resolve at computed-value time, such as font-size and line-height.
        const computed: CssValue | undefined = this.compute(value, relative);
        if (computed === undefined) {
            return undefined;
        }
        if (computed.kind === "length") {
            return computed.px;
        }
        if (computed.kind === "percentage") {
            return basis * computed.value / 100;
        }
        if (computed.kind !== "calc") {
            return undefined;
        }
        const context: CalcContext = {
            toCanonical: (number: number, unit: string): number | undefined => this.units.toCanonical(number, unit),
            resolvePercentage: (percentage: number): CalcLeaf => ({ kind: "leaf", value: basis * percentage / 100, unit: PIXELS }),
            rawPercentages: false
        };
        const resolved: CalcNode = this.simplifier.simplify(computed.root, context);
        return resolved.kind === "leaf" && resolved.unit === PIXELS ? this.finite(resolved.value) : undefined;
    }

    computeNumber(value: CssValue, relative: RelativeUnits): number | undefined {
        if (value.kind === "number") {
            return value.value;
        }
        if (value.kind !== "calc") {
            return undefined;
        }
        const root: CalcNode = this.simplifier.simplify(value.root, this.context(relative));
        return root.kind === "leaf" && root.unit === "" ? root.value : undefined;
    }

    substituted(root: CalcNode, replacement: CalcNode): CalcNode {
        // CSS Values 5 §10.1: "replace every instance of the size keyword in calc with insertion value".
        if (root.kind === "leaf" || root.kind === "channel") {
            return root.kind === "channel" && root.name === SIZE ? replacement : root;
        }
        if (root.kind === "anchor") {
            return root.fallback === undefined ? root : { ...root, fallback: this.substituted(root.fallback, replacement) };
        }
        const children: Array<CalcNode> = root.children.map((child: CalcNode) => this.substituted(child, replacement));
        return root.kind === "round" ? { kind: "round", strategy: root.strategy, children } : { kind: "operation", operator: root.operator, children };
    }

    depercentified(root: CalcNode): CalcNode {
        // §10.1: "Replace every instance of a <percentage-token> in calc with (size * N), where N is the percentage's
        // value divided by 100."
        if (root.kind === "leaf" || root.kind === "channel") {
            return root.kind === "leaf" && root.unit === "%"
                ? { kind: "operation", operator: "product", children: [{ kind: "channel", name: SIZE }, { kind: "leaf", value: root.value / 100, unit: "" }] } : root;
        }
        if (root.kind === "anchor") {
            return root.fallback === undefined ? root : { ...root, fallback: this.depercentified(root.fallback) };
        }
        const children: Array<CalcNode> = root.children.map((child: CalcNode) => this.depercentified(child));
        return root.kind === "round" ? { kind: "round", strategy: root.strategy, children } : { kind: "operation", operator: root.operator, children };
    }

    percentFree(root: CalcNode, basis: number): CalcNode {
        // §10.2: in the calculation, "if percentages are not definite in the given context, they resolve to 0px", which is
        // the basis that the caller gives then.
        return this.simplifier.simplify(root, {
            toCanonical: (number: number, unit: string): number | undefined => this.units.toCanonical(number, unit),
            resolvePercentage: (percentage: number): CalcLeaf => ({ kind: "leaf", value: basis * percentage / 100, unit: PIXELS }),
            rawPercentages: false
        });
    }

    sized(root: CalcNode, size: number): number | undefined {
        // §10.2: the calculation is evaluated "with the size keyword evaluating to the calc-size basis's original size."
        const resolved: CalcNode = this.percentFree(this.substituted(root, { kind: "leaf", value: size, unit: PIXELS }), 0);
        return resolved.kind === "leaf" && resolved.unit === PIXELS ? this.finite(resolved.value) : undefined;
    }

    anchored(root: CalcNode, resolve: (anchor: CalcAnchor) => number | undefined): CalcNode | undefined {
        // CSS Anchor Positioning 1 §5.1.1: an anchor function that cannot be resolved "resolves to its specified fallback
        // value. If no fallback value is specified, it makes the declaration referencing it invalid at computed-value time."
        if (root.kind === "anchor") {
            const length: number | undefined = resolve(root);
            if (length !== undefined) {
                return { kind: "leaf", value: length, unit: PIXELS };
            }
            return root.fallback === undefined ? undefined : this.anchored(root.fallback, resolve);
        }
        if (root.kind === "leaf" || root.kind === "channel") {
            return root;
        }
        let children: Array<CalcNode> | undefined;
        for (let index: number = 0; index < root.children.length; index++) {
            const child: CalcNode = root.children[index];
            const replaced: CalcNode | undefined = this.anchored(child, resolve);
            if (replaced === undefined) {
                return undefined;
            }
            if (replaced !== child) {
                children = children ?? [...root.children];
                children[index] = replaced;
            }
        }
        if (children === undefined) {
            return root;
        }
        return root.kind === "round" ? { kind: "round", strategy: root.strategy, children } : { kind: "operation", operator: root.operator, children };
    }

    owned(root: CalcNode, owner: number): CalcNode {
        // The anchor functions of a box's computed value keep the box they resolve for, which a descendant that inherits the
        // value resolves them with.
        if (root.kind === "anchor") {
            const anchor: CalcAnchor = { ...root, owner };
            if (root.fallback !== undefined) {
                anchor.fallback = this.owned(root.fallback, owner);
            }
            return anchor;
        }
        if (root.kind === "leaf" || root.kind === "channel") {
            return root;
        }
        const children: Array<CalcNode> = root.children.map((child: CalcNode) => this.owned(child, owner));
        return root.kind === "round" ? { kind: "round", strategy: root.strategy, children } : { kind: "operation", operator: root.operator, children };
    }

    private computeCalc(root: CalcNode, relative: RelativeUnits): CssValue | undefined {
        const simplified: CalcNode = this.simplifier.simplify(root, this.context(relative));
        if (simplified.kind === "leaf") {
            if (simplified.unit === PIXELS) {
                return { kind: "length", px: this.finite(simplified.value) };
            }
            return simplified.unit === "%" ? { kind: "percentage", value: this.finite(simplified.value) } : undefined;
        }
        return this.onlyPixelsAndPercentages(simplified) ? { kind: "calc", root: simplified } : undefined;
    }

    private context(relative: RelativeUnits): CalcContext {
        return {
            toCanonical: (value: number, unit: string): number | undefined => this.pixels(value, unit, relative) ?? this.units.toCanonical(value, unit),
            resolvePercentage: (): CalcLeaf | undefined => undefined,
            rawPercentages: false
        };
    }

    private pixels(value: number, unit: string, relative: RelativeUnits): number | undefined {
        if (this.units.baseTypeOf(unit) !== "length") {
            return undefined;
        }
        const absolute: number | undefined = this.units.toCanonical(value, unit);
        if (absolute !== undefined) {
            return relative.absolute === undefined ? absolute : absolute * relative.absolute();
        }
        const size: number | undefined = relative.size(unit);
        return size === undefined ? undefined : value * size;
    }

    private onlyPixelsAndPercentages(node: CalcNode): boolean {
        if (node.kind === "leaf") {
            return node.unit === PIXELS || node.unit === "%" || node.unit === "";
        }
        if (node.kind === "channel") {
            // The size keyword of calc-size() has its length only when the box is laid out.
            return node.name === SIZE;
        }
        if (node.kind === "anchor") {
            // CSS Anchor Positioning 1 §5.1: the length of an anchor function "resolves at computed value time (via style &
            // layout interleaving)", when the box is laid out.
            return node.fallback === undefined || this.onlyPixelsAndPercentages(node.fallback);
        }
        return node.children.every((child: CalcNode) => this.onlyPixelsAndPercentages(child));
    }

    private finite(value: number): number {
        // CSS Values 4 §10.9.1: NaN is censored into zero, and infinities are clamped to the allowed range, as §10.12 defines.
        if (Number.isNaN(value)) {
            return 0;
        }
        return Math.min(Math.max(value, -Number.MAX_VALUE), Number.MAX_VALUE);
    }
}
