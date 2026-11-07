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

import { CssUnits } from "./CssUnits.js";
import type { BaseType, CalcNode } from "./CssValue.js";

export interface NumericType {
    exponents: Readonly<Record<BaseType, number>>;
    percentHint?: BaseType;
}

export type NumericCategory = "number" | "percentage" | Exclude<BaseType, "percent">;

const BASE_TYPES: ReadonlyArray<BaseType> = ["length", "angle", "time", "frequency", "resolution", "flex", "percent"];

const EMPTY_EXPONENTS: Readonly<Record<BaseType, number>> = { length: 0, angle: 0, time: 0, frequency: 0, resolution: 0, flex: 0, percent: 0 };

export class CalcTypes {

    private readonly units: CssUnits = new CssUnits();

    ofUnit(unit: string): NumericType | undefined {
        if (unit === "") {
            return { exponents: EMPTY_EXPONENTS };
        }
        if (unit === "%") {
            return { exponents: { ...EMPTY_EXPONENTS, percent: 1 } };
        }
        const base: BaseType | undefined = this.units.baseTypeOf(unit);
        return base === undefined ? undefined : { exponents: { ...EMPTY_EXPONENTS, [base]: 1 } };
    }

    add(first: NumericType, second: NumericType): NumericType | undefined {
        // CSS Typed OM 1 §4.3.2, "add two types".
        let type1: Record<BaseType, number> = { ...first.exponents };
        let type2: Record<BaseType, number> = { ...second.exponents };
        let hint1: BaseType | undefined = first.percentHint;
        let hint2: BaseType | undefined = second.percentHint;
        if (hint1 !== undefined && hint2 !== undefined && hint1 !== hint2) {
            return undefined;
        }
        if (hint1 !== undefined && hint2 === undefined) {
            type2 = this.applyPercentHint(type2, hint1);
            hint2 = hint1;
        } else if (hint2 !== undefined && hint1 === undefined) {
            type1 = this.applyPercentHint(type1, hint2);
            hint1 = hint2;
        }
        if (this.sameNonZeroEntries(type1, type2)) {
            return this.typed(type1, hint1);
        }
        const hasPercent: boolean = type1.percent !== 0 || type2.percent !== 0;
        const hasOther: boolean = BASE_TYPES.some((base: BaseType) => base !== "percent" && (type1[base] !== 0 || type2[base] !== 0));
        if (!hasPercent || !hasOther) {
            return undefined;
        }
        for (const hint of BASE_TYPES) {
            if (hint === "percent") {
                continue;
            }
            const hinted1: Record<BaseType, number> = this.applyPercentHint(type1, hint);
            const hinted2: Record<BaseType, number> = this.applyPercentHint(type2, hint);
            if (this.sameNonZeroEntries(hinted1, hinted2)) {
                return { exponents: hinted1, percentHint: hint };
            }
        }
        return undefined;
    }

    multiply(first: NumericType, second: NumericType): NumericType | undefined {
        // CSS Typed OM 1 §4.3.2, "multiply two types".
        let type1: Record<BaseType, number> = { ...first.exponents };
        let type2: Record<BaseType, number> = { ...second.exponents };
        let hint1: BaseType | undefined = first.percentHint;
        const hint2: BaseType | undefined = second.percentHint;
        if (hint1 !== undefined && hint2 !== undefined && hint1 !== hint2) {
            return undefined;
        }
        if (hint1 !== undefined && hint2 === undefined) {
            type2 = this.applyPercentHint(type2, hint1);
        } else if (hint2 !== undefined && hint1 === undefined) {
            type1 = this.applyPercentHint(type1, hint2);
            hint1 = hint2;
        }
        const exponents: Record<BaseType, number> = { ...type1 };
        for (const base of BASE_TYPES) {
            exponents[base] += type2[base];
        }
        return this.typed(exponents, hint1);
    }

    private typed(exponents: Record<BaseType, number>, percentHint?: BaseType): NumericType {
        return percentHint === undefined ? { exponents } : { exponents, percentHint };
    }

    invert(type: NumericType): NumericType {
        const exponents: Record<BaseType, number> = { ...EMPTY_EXPONENTS };
        for (const base of BASE_TYPES) {
            exponents[base] = type.exponents[base] === 0 ? 0 : -type.exponents[base];
        }
        return this.typed(exponents, type.percentHint);
    }

    private makeConsistent(base: NumericType, input: NumericType): NumericType | undefined {
        if (base.percentHint !== undefined && input.percentHint !== undefined && base.percentHint !== input.percentHint) {
            return undefined;
        }
        return this.typed(base.exponents, base.percentHint ?? input.percentHint);
    }

    categoryOf(type: NumericType): NumericCategory | undefined {
        // CSS Values 4 §10.9: the productions a type can match are mutually exclusive.
        let found: BaseType | undefined;
        for (const base of BASE_TYPES) {
            const exponent: number = type.exponents[base];
            if (exponent === 0) {
                continue;
            }
            if (exponent !== 1 || found !== undefined) {
                return undefined;
            }
            found = base;
        }
        if (found === undefined) {
            return "number";
        }
        return found === "percent" ? "percentage" : found;
    }

    typeOf(node: CalcNode, percentBasis?: Exclude<BaseType, "percent">): NumericType | undefined {
        // CSS Values 4 §10.9; percentBasis is the type percentages resolve against in the context, undefined when there is none or it is <number>.
        if (node.kind === "leaf") {
            if (node.unit === "%" && percentBasis !== undefined) {
                return { exponents: { ...EMPTY_EXPONENTS, [percentBasis]: 1 }, percentHint: percentBasis };
            }
            return this.ofUnit(node.unit);
        }
        if (node.kind === "channel") {
            // CSS Color 5 §4.2: "The component keywords return a <number>".
            return this.ofUnit("");
        }
        if (node.kind === "anchor") {
            // CSS Anchor Positioning 1 §5: "The anchor-size() function resolves to a <length>."
            return this.ofUnit("px");
        }
        const childTypes: Array<NumericType> = [];
        for (const child of node.children) {
            const childType: NumericType | undefined = this.typeOf(child, percentBasis);
            if (childType === undefined) {
                return undefined;
            }
            childTypes.push(childType);
        }
        if (node.kind === "round") {
            return this.addAll(childTypes);
        }
        switch (node.operator) {
            case "sum":
            case "min":
            case "max":
            case "clamp":
            case "hypot":
            case "mod":
            case "rem":
                return this.addAll(childTypes);
            case "product":
                return this.multiplyAll(childTypes);
            case "negate":
                return childTypes[0];
            case "invert":
                return this.invert(childTypes[0]);
            case "abs":
                return childTypes[0];
            case "sign":
                return this.numberConsistentWith(childTypes[0]);
            case "sin":
            case "cos":
            case "tan": {
                const category: NumericCategory | undefined = this.categoryOf(childTypes[0]);
                return category === "number" || category === "angle" ? this.numberConsistentWith(childTypes[0]) : undefined;
            }
            case "asin":
            case "acos":
            case "atan":
                return this.categoryOf(childTypes[0]) === "number" ? this.angleConsistentWith(childTypes[0]) : undefined;
            case "atan2": {
                const consistent: NumericType | undefined = this.addAll(childTypes);
                return consistent === undefined ? undefined : this.angleConsistentWith(consistent);
            }
            case "pow": {
                const consistent: NumericType | undefined = this.addAll(childTypes);
                return consistent !== undefined && this.categoryOf(consistent) === "number" ? consistent : undefined;
            }
            case "sqrt":
            case "exp":
                return this.categoryOf(childTypes[0]) === "number" ? this.numberConsistentWith(childTypes[0]) : undefined;
            case "log": {
                if (!childTypes.every((childType: NumericType) => this.categoryOf(childType) === "number")) {
                    return undefined;
                }
                const consistent: NumericType | undefined = this.addAll(childTypes);
                return consistent === undefined ? undefined : this.numberConsistentWith(consistent);
            }
        }
    }

    private addAll(types: ReadonlyArray<NumericType>): NumericType | undefined {
        let result: NumericType | undefined = types[0];
        for (let index: number = 1; index < types.length && result !== undefined; index++) {
            result = this.add(result, types[index]);
        }
        return result;
    }

    private multiplyAll(types: ReadonlyArray<NumericType>): NumericType | undefined {
        let result: NumericType | undefined = types[0];
        for (let index: number = 1; index < types.length && result !== undefined; index++) {
            result = this.multiply(result, types[index]);
        }
        return result;
    }

    private numberConsistentWith(input: NumericType): NumericType | undefined {
        return this.makeConsistent({ exponents: EMPTY_EXPONENTS }, input);
    }

    private angleConsistentWith(input: NumericType): NumericType | undefined {
        return this.makeConsistent({ exponents: { ...EMPTY_EXPONENTS, angle: 1 } }, input);
    }

    private applyPercentHint(type: Readonly<Record<BaseType, number>>, hint: BaseType): Record<BaseType, number> {
        const result: Record<BaseType, number> = { ...type };
        result[hint] += result.percent;
        result.percent = 0;
        return result;
    }

    private sameNonZeroEntries(type1: Readonly<Record<BaseType, number>>, type2: Readonly<Record<BaseType, number>>): boolean {
        return BASE_TYPES.every((base: BaseType) => type1[base] === type2[base]);
    }
}
