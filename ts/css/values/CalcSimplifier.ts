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

import type { NumericCategory, NumericType } from "./CalcTypes.js";
import { CalcTypes } from "./CalcTypes.js";
import { CssUnits } from "./CssUnits.js";
import type { BaseType, CalcLeaf, CalcNode, CalcOperation, CalcOperator, RoundingStrategy } from "./CssValue.js";

export interface CalcContext {
    toCanonical(value: number, unit: string): number | undefined;
    resolvePercentage(value: number): CalcLeaf | undefined;
    rawPercentages: boolean;
}

const SAME_UNIT_OPERATORS: ReadonlySet<CalcOperator> = new Set<CalcOperator>(["min", "max", "clamp", "hypot", "mod", "rem", "atan2"]);

export class CalcSimplifier {

    private readonly units: CssUnits = new CssUnits();
    private readonly types: CalcTypes = new CalcTypes();

    specifiedContext(): CalcContext {
        // At parse time only the units with a fixed ratio to their canonical unit convert, and no percentage resolves.
        return {
            toCanonical: (value: number, unit: string): number | undefined => this.units.toCanonical(value, unit),
            resolvePercentage: (): CalcLeaf | undefined => undefined,
            rawPercentages: false
        };
    }

    simplify(root: CalcNode, context: CalcContext): CalcNode {
        // CSS Values 4 §10.10.1.
        if (root.kind === "leaf") {
            return this.simplifyLeaf(root, context);
        }
        if (root.kind === "channel") {
            return root;
        }
        if (root.kind === "anchor") {
            // The length of an anchor function is known only during layout; its fallback simplifies as any calculation.
            return root.fallback === undefined ? root : { ...root, fallback: this.simplify(root.fallback, context) };
        }
        const children: Array<CalcNode> = root.children.map((child: CalcNode) => this.simplify(child, context));
        if (root.kind === "round") {
            return this.simplifyRounding(root.strategy, children, context);
        }
        switch (root.operator) {
            case "negate":
                return this.simplifyNegate(children[0]);
            case "invert":
                return this.simplifyInvert(children[0]);
            case "sum":
                return this.simplifySum(children);
            case "product":
                return this.simplifyProduct(children);
            default:
                return this.simplifyFunction(root.operator, children, context);
        }
    }

    private simplifyLeaf(leaf: CalcLeaf, context: CalcContext): CalcNode {
        if (leaf.unit === "%") {
            return context.resolvePercentage(leaf.value) ?? leaf;
        }
        if (leaf.unit === "") {
            return leaf;
        }
        const base: BaseType | undefined = this.units.baseTypeOf(leaf.unit);
        if (base === undefined) {
            return leaf;
        }
        const canonical: string = this.units.canonicalUnitOf(base);
        if (leaf.unit === canonical) {
            return leaf;
        }
        const converted: number | undefined = context.toCanonical(leaf.value, leaf.unit);
        return converted === undefined ? leaf : { kind: "leaf", value: converted, unit: canonical };
    }

    private simplifyNegate(child: CalcNode): CalcNode {
        if (child.kind === "leaf") {
            return { kind: "leaf", value: 0 - child.value, unit: child.unit };
        }
        if (child.kind === "operation" && child.operator === "negate") {
            return child.children[0];
        }
        return { kind: "operation", operator: "negate", children: [child] };
    }

    private simplifyInvert(child: CalcNode): CalcNode {
        if (child.kind === "leaf" && child.unit === "") {
            return { kind: "leaf", value: 1 / child.value, unit: "" };
        }
        if (child.kind === "operation" && child.operator === "invert") {
            return child.children[0];
        }
        return { kind: "operation", operator: "invert", children: [child] };
    }

    private simplifySum(children: ReadonlyArray<CalcNode>): CalcNode {
        const flattened: Array<CalcNode> = [];
        for (const child of children) {
            if (child.kind === "operation" && child.operator === "sum") {
                flattened.push(...child.children);
            } else {
                flattened.push(child);
            }
        }
        // Zero-valued terms stay: only values with identical units combine (CSS Values 4 §10.10.1).
        const combined: Array<CalcNode> = [];
        for (const child of flattened) {
            if (child.kind !== "leaf") {
                combined.push(child);
                continue;
            }
            const index: number = combined.findIndex((existing: CalcNode) => existing.kind === "leaf" && existing.unit === child.unit);
            if (index === -1) {
                combined.push(child);
            } else {
                const existing: CalcLeaf = combined[index] as CalcLeaf;
                combined[index] = { kind: "leaf", value: existing.value + child.value, unit: child.unit };
            }
        }
        return combined.length === 1 ? combined[0] : { kind: "operation", operator: "sum", children: combined };
    }

    private simplifyProduct(children: ReadonlyArray<CalcNode>): CalcNode {
        const flattened: Array<CalcNode> = [];
        for (const child of children) {
            if (child.kind === "operation" && child.operator === "product") {
                flattened.push(...child.children);
            } else {
                flattened.push(child);
            }
        }
        const numbers: Array<CalcLeaf> = flattened.filter((child: CalcNode): child is CalcLeaf => child.kind === "leaf" && child.unit === "");
        let reduced: Array<CalcNode> = flattened;
        if (numbers.length > 1) {
            let product: number = 1;
            for (const number of numbers) {
                product *= number.value;
            }
            const firstNumber: number = flattened.indexOf(numbers[0]);
            reduced = flattened.filter((child: CalcNode) => !numbers.includes(child as CalcLeaf));
            reduced.splice(firstNumber, 0, { kind: "leaf", value: product, unit: "" });
        }
        if (reduced.length === 2) {
            const numberIndex: number = reduced.findIndex((child: CalcNode) => child.kind === "leaf" && child.unit === "");
            const other: CalcNode | undefined = numberIndex === -1 ? undefined : reduced[1 - numberIndex];
            if (other !== undefined && other.kind === "operation" && other.operator === "sum" && other.children.every((child: CalcNode) => child.kind === "leaf")) {
                const factor: number = (reduced[numberIndex] as CalcLeaf).value;
                return {
                    kind: "operation",
                    operator: "sum",
                    children: other.children.map((child: CalcNode): CalcNode => ({ kind: "leaf", value: (child as CalcLeaf).value * factor, unit: (child as CalcLeaf).unit }))
                };
            }
        }
        const multiplied: CalcLeaf | undefined = this.multiplyLeaves(reduced);
        if (multiplied !== undefined) {
            return multiplied;
        }
        return reduced.length === 1 ? reduced[0] : { kind: "operation", operator: "product", children: reduced };
    }

    private multiplyLeaves(children: ReadonlyArray<CalcNode>): CalcLeaf | undefined {
        // The values can be multiplied only when each is a number, a percentage or a dimension in its canonical unit, alone or inverted.
        let type: NumericType | undefined = this.types.ofUnit("");
        let value: number = 1;
        for (const child of children) {
            const inverted: boolean = child.kind === "operation" && child.operator === "invert";
            const leaf: CalcNode = inverted ? (child as CalcOperation).children[0] : child;
            if (leaf.kind !== "leaf" || !this.isCanonical(leaf.unit)) {
                return undefined;
            }
            const leafType: NumericType | undefined = this.types.ofUnit(leaf.unit);
            if (leafType === undefined || type === undefined) {
                return undefined;
            }
            type = this.types.multiply(type, inverted ? this.types.invert(leafType) : leafType);
            value = inverted ? value / leaf.value : value * leaf.value;
        }
        const category: NumericCategory | undefined = type === undefined ? undefined : this.types.categoryOf(type);
        if (category === undefined) {
            return undefined;
        }
        return { kind: "leaf", value, unit: this.unitOfCategory(category) };
    }

    private simplifyFunction(operator: CalcOperator, children: ReadonlyArray<CalcNode>, context: CalcContext): CalcNode {
        const leaves: Array<CalcLeaf> | undefined = this.comparableLeaves(operator, children, context);
        if (leaves !== undefined) {
            const result: CalcLeaf | undefined = this.evaluate(operator, leaves);
            if (result !== undefined) {
                return result;
            }
        }
        if (operator === "min" || operator === "max") {
            return this.partiallySimplifyMinMax(operator, children, context);
        }
        return { kind: "operation", operator, children };
    }

    private simplifyRounding(strategy: RoundingStrategy, children: ReadonlyArray<CalcNode>, context: CalcContext): CalcNode {
        const leaves: Array<CalcLeaf> | undefined = this.sameUnitLeaves(children, context);
        if (leaves !== undefined) {
            return { kind: "leaf", value: this.round(strategy, leaves[0].value, leaves[1].value), unit: leaves[0].unit };
        }
        return { kind: "round", strategy, children };
    }

    private partiallySimplifyMinMax(operator: "min" | "max", children: ReadonlyArray<CalcNode>, context: CalcContext): CalcNode {
        const combined: Array<CalcNode> = [];
        for (const child of children) {
            if (child.kind !== "leaf" || (child.unit === "%" && !context.rawPercentages)) {
                combined.push(child);
                continue;
            }
            const index: number = combined.findIndex((existing: CalcNode) => existing.kind === "leaf" && existing.unit === child.unit);
            if (index === -1) {
                combined.push(child);
            } else {
                const existing: CalcLeaf = combined[index] as CalcLeaf;
                const value: number = operator === "min" ? Math.min(existing.value, child.value) : Math.max(existing.value, child.value);
                combined[index] = { kind: "leaf", value, unit: child.unit };
            }
        }
        return combined.length === 1 ? combined[0] : { kind: "operation", operator, children: combined };
    }

    private comparableLeaves(operator: CalcOperator, children: ReadonlyArray<CalcNode>, context: CalcContext): Array<CalcLeaf> | undefined {
        if (SAME_UNIT_OPERATORS.has(operator)) {
            return this.sameUnitLeaves(children, context);
        }
        const leaves: Array<CalcLeaf> = [];
        for (const child of children) {
            if (child.kind !== "leaf" || (child.unit === "%" && !context.rawPercentages)) {
                return undefined;
            }
            leaves.push(child);
        }
        return leaves;
    }

    private sameUnitLeaves(children: ReadonlyArray<CalcNode>, context: CalcContext): Array<CalcLeaf> | undefined {
        // A percentage that resolves against another value cannot be compared or combined until it is resolved.
        const leaves: Array<CalcLeaf> = [];
        for (const child of children) {
            if (child.kind !== "leaf" || (child.unit === "%" && !context.rawPercentages) || (leaves.length > 0 && child.unit !== leaves[0].unit)) {
                return undefined;
            }
            leaves.push(child);
        }
        return leaves;
    }

    private evaluate(operator: CalcOperator, leaves: ReadonlyArray<CalcLeaf>): CalcLeaf | undefined {
        const first: CalcLeaf = leaves[0];
        const unit: string = first.unit;
        const values: Array<number> = leaves.map((leaf: CalcLeaf) => leaf.value);
        const anyNaN: boolean = values.some((value: number) => Number.isNaN(value));
        switch (operator) {
            case "min":
                return { kind: "leaf", value: Math.min(...values), unit };
            case "max":
                return { kind: "leaf", value: Math.max(...values), unit };
            case "clamp":
                return { kind: "leaf", value: Math.max(values[0], Math.min(values[1], values[2])), unit };
            case "hypot":
                return { kind: "leaf", value: anyNaN ? Number.NaN : Math.hypot(...values), unit };
            case "mod":
                return { kind: "leaf", value: this.modulus(values[0], values[1]), unit };
            case "rem":
                return { kind: "leaf", value: this.remainder(values[0], values[1]), unit };
            case "abs":
                return { kind: "leaf", value: Math.abs(first.value), unit };
            case "sign":
                return { kind: "leaf", value: Math.sign(first.value), unit: "" };
            case "sin":
            case "cos":
            case "tan":
                return this.trigonometric(operator, first);
            case "asin":
            case "acos":
            case "atan":
                return this.inverseTrigonometric(operator, first);
            case "atan2":
                return { kind: "leaf", value: this.degrees(Math.atan2(values[0], values[1])), unit: "deg" };
            case "pow":
                return this.numbersOnly(leaves) ? { kind: "leaf", value: anyNaN ? Number.NaN : Math.pow(values[0], values[1]), unit: "" } : undefined;
            case "sqrt":
                return this.numbersOnly(leaves) ? { kind: "leaf", value: Math.sqrt(first.value), unit: "" } : undefined;
            case "exp":
                return this.numbersOnly(leaves) ? { kind: "leaf", value: Math.exp(first.value), unit: "" } : undefined;
            case "log":
                return this.numbersOnly(leaves) ? { kind: "leaf", value: this.logarithm(values[0], leaves.length > 1 ? values[1] : undefined), unit: "" } : undefined;
            default:
                return undefined;
        }
    }

    private trigonometric(operator: "sin" | "cos" | "tan", leaf: CalcLeaf): CalcLeaf | undefined {
        if (leaf.unit !== "" && leaf.unit !== "deg") {
            return undefined;
        }
        if (operator === "tan" && leaf.unit === "deg" && Number.isFinite(leaf.value)) {
            // CSS Values 4 §10.4.1: asymptotes that are exactly representable give +∞ at 90deg + N*360deg and −∞ at -90deg + N*360deg.
            const turn: number = ((leaf.value % 360) + 360) % 360;
            if (turn === 90) {
                return { kind: "leaf", value: Infinity, unit: "" };
            }
            if (turn === 270) {
                return { kind: "leaf", value: -Infinity, unit: "" };
            }
        }
        const radians: number = leaf.unit === "deg" ? leaf.value * Math.PI / 180 : leaf.value;
        const value: number = operator === "sin" ? Math.sin(radians) : (operator === "cos" ? Math.cos(radians) : Math.tan(radians));
        return { kind: "leaf", value, unit: "" };
    }

    private inverseTrigonometric(operator: "asin" | "acos" | "atan", leaf: CalcLeaf): CalcLeaf | undefined {
        if (leaf.unit !== "") {
            return undefined;
        }
        const radians: number = operator === "asin" ? Math.asin(leaf.value) : (operator === "acos" ? Math.acos(leaf.value) : Math.atan(leaf.value));
        return { kind: "leaf", value: this.degrees(radians), unit: "deg" };
    }

    private degrees(radians: number): number {
        return radians * 180 / Math.PI;
    }

    private round(strategy: RoundingStrategy, a: number, b: number): number {
        // CSS Values 4 §10.3 and §10.3.1.
        if (Number.isNaN(a) || Number.isNaN(b) || b === 0 || (!Number.isFinite(a) && !Number.isFinite(b))) {
            return Number.NaN;
        }
        if (!Number.isFinite(a)) {
            return a;
        }
        const positive: boolean = a > 0 || Object.is(a, 0);
        if (!Number.isFinite(b)) {
            switch (strategy) {
                case "up":
                    return a > 0 ? Infinity : (positive ? 0 : -0);
                case "down":
                    return a < 0 ? -Infinity : (positive ? 0 : -0);
                default:
                    return positive ? 0 : -0;
            }
        }
        const step: number = Math.abs(b);
        const lower: number = Math.floor(a / step) * step;
        if (lower === a) {
            return a;
        }
        const upper: number = lower + step;
        let chosenUpper: boolean;
        switch (strategy) {
            case "up":
                chosenUpper = true;
                break;
            case "down":
                chosenUpper = false;
                break;
            case "to-zero":
                chosenUpper = Math.abs(upper) < Math.abs(lower);
                break;
            default:
                chosenUpper = Math.abs(upper - a) <= Math.abs(a - lower);
                break;
        }
        if (chosenUpper) {
            return upper === 0 ? -0 : upper;
        }
        return lower === 0 ? 0 : lower;
    }

    private modulus(a: number, b: number): number {
        // CSS Values 4 §10.3: the result is between zero and B, starting at 0⁺ when B is positive and at 0⁻ when it is negative.
        if (Number.isNaN(a) || Number.isNaN(b) || b === 0 || !Number.isFinite(a)) {
            return Number.NaN;
        }
        if (!Number.isFinite(b)) {
            const aNegative: boolean = a < 0 || Object.is(a, -0);
            return aNegative !== (b < 0) ? Number.NaN : a;
        }
        let result: number = a % b;
        if (result !== 0 && (result < 0) !== (b < 0)) {
            result += b;
        }
        if (result === 0) {
            return b < 0 ? -0 : 0;
        }
        return result;
    }

    private remainder(a: number, b: number): number {
        if (Number.isNaN(a) || Number.isNaN(b) || b === 0 || !Number.isFinite(a)) {
            return Number.NaN;
        }
        if (!Number.isFinite(b)) {
            return a;
        }
        return a % b;
    }

    private logarithm(a: number, b?: number): number {
        // CSS Values 4 §10.5.1.
        if (Number.isNaN(a) || (b !== undefined && Number.isNaN(b))) {
            return Number.NaN;
        }
        if (b !== undefined && (b === 1 || b < 0)) {
            return Number.NaN;
        }
        if (a < 0) {
            return Number.NaN;
        }
        if (a === 0) {
            return -Infinity;
        }
        if (a === 1) {
            return 0;
        }
        if (a === Infinity) {
            return Infinity;
        }
        return b === undefined ? Math.log(a) : Math.log(a) / Math.log(b);
    }

    private numbersOnly(leaves: ReadonlyArray<CalcLeaf>): boolean {
        return leaves.every((leaf: CalcLeaf) => leaf.unit === "");
    }

    private isCanonical(unit: string): boolean {
        if (unit === "" || unit === "%") {
            return true;
        }
        const base: BaseType | undefined = this.units.baseTypeOf(unit);
        return base !== undefined && this.units.canonicalUnitOf(base) === unit;
    }

    private unitOfCategory(category: NumericCategory): string {
        if (category === "number") {
            return "";
        }
        return category === "percentage" ? "%" : this.units.canonicalUnitOf(category);
    }
}
