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

import type { CssNode, FunctionNode } from "css-tree";
import { AsciiCase } from "../AsciiCase.js";
import { CssIdentifierEscaping } from "../CssIdentifierEscaping.js";
import type { NumericType } from "./CalcTypes.js";
import { CalcTypes } from "./CalcTypes.js";
import { CalcSimplifier } from "./CalcSimplifier.js";
import { ColorSpaces } from "./ColorSpaces.js";
import type { CalcAnchor, CalcNode, CalcOperator, RoundingStrategy } from "./CssValue.js";

const MATH_FUNCTIONS: ReadonlySet<string> = new Set<string>([
    "calc", "min", "max", "clamp", "round", "mod", "rem", "sin", "cos", "tan", "asin", "acos", "atan", "atan2",
    "pow", "sqrt", "hypot", "log", "exp", "abs", "sign"
]);

const ONE_ARGUMENT: ReadonlySet<string> = new Set<string>(["sin", "cos", "tan", "asin", "acos", "atan", "sqrt", "exp", "abs", "sign"]);

const TWO_ARGUMENTS: ReadonlySet<string> = new Set<string>(["mod", "rem", "atan2", "pow"]);

const LIST_ARGUMENTS: ReadonlySet<string> = new Set<string>(["min", "max", "hypot"]);

const ROUNDING_STRATEGIES: ReadonlySet<string> = new Set<string>(["nearest", "up", "down", "to-zero"]);

const CONSTANTS: ReadonlyMap<string, number> = new Map<string, number>([
    ["e", Math.E],
    ["pi", Math.PI],
    ["infinity", Infinity],
    ["-infinity", -Infinity],
    ["nan", Number.NaN]
]);

const SIZE_KEYWORD: ReadonlySet<string> = new Set<string>(["size"]);

const ANCHOR_SIZE: string = "anchor-size";

const ANCHOR_SIZES: ReadonlySet<string> = new Set<string>(["width", "height", "block", "inline", "self-block", "self-inline"]);

export class CalcParser {

    private readonly asciiCase: AsciiCase = new AsciiCase();
    private readonly escaping: CssIdentifierEscaping = new CssIdentifierEscaping();
    private readonly types: CalcTypes = new CalcTypes();
    private readonly simplifier: CalcSimplifier = new CalcSimplifier();

    isMathFunction(name: string): boolean {
        return MATH_FUNCTIONS.has(name);
    }

    parse(node: FunctionNode, channels?: ReadonlySet<string>): CalcNode | undefined {
        // CSS Values 4 §10.10: the internal representation is simplified as soon as it is parsed. CSS Color 5 §4.2: inside a
        // relative color, "Math functions can also use these keywords", which are the channels given here.
        const tree: CalcNode | undefined = this.parseFunction(node, channels);
        return tree === undefined ? undefined : this.simplifier.simplify(tree, this.simplifier.specifiedContext());
    }

    parseSize(nodes: ReadonlyArray<CssNode>, sized: boolean): CalcNode | undefined {
        // CSS Values 5 §10: an argument of calc-size() given as a <calc-sum> has a type that "must match
        // <length-percentage>", and in the calculation "the keyword size is allowed. This keyword is a <length>".
        const tree: CalcNode | undefined = this.parseCalculation(nodes, sized ? SIZE_KEYWORD : undefined);
        const type: NumericType | undefined = tree === undefined ? undefined : this.types.typeOf(this.sizeAsLength(tree), "length");
        if (tree === undefined || type === undefined || this.types.categoryOf(type) !== "length") {
            return undefined;
        }
        return this.simplifier.simplify(tree, this.simplifier.specifiedContext());
    }

    parseAnchor(node: FunctionNode): CalcNode | undefined {
        // CSS Anchor Positioning 1 §5: "The anchor-size() function resolves to a <length>", as a whole value or in a calculation.
        const anchor: CalcNode | undefined = this.parseAnchorSize(node);
        return anchor === undefined ? undefined : this.simplifier.simplify(anchor, this.simplifier.specifiedContext());
    }

    private parseAnchorSize(node: FunctionNode): CalcNode | undefined {
        // §5.1: anchor-size( [ <anchor-name> || <anchor-size> ]? , <length-percentage>? ); CSS Values 4 §2.1: the comma is
        // omitted when either side of it is.
        const nodes: Array<CssNode> = node.children.toArray();
        const comma: number = nodes.findIndex((item: CssNode) => item.type === "Operator" && item.value.trim() === ",");
        const named: boolean = nodes.every((item: CssNode) => item.type === "Identifier");
        const specifier: ReadonlyArray<CssNode> = comma === -1 ? (named ? nodes : []) : nodes.slice(0, comma);
        const fallback: ReadonlyArray<CssNode> = comma === -1 ? (named ? [] : nodes) : nodes.slice(comma + 1);
        if (comma !== -1 && (specifier.length === 0 || fallback.length === 0)) {
            return undefined;
        }
        const anchor: CalcAnchor = { kind: "anchor", name: ANCHOR_SIZE };
        for (const item of specifier) {
            const text: string = item.type === "Identifier" ? this.escaping.unescape(item.name) : "";
            const keyword: string = this.asciiCase.foldLower(text);
            if (text.startsWith("--") && anchor.anchor === undefined) {
                anchor.anchor = text;
            } else if (ANCHOR_SIZES.has(keyword) && anchor.keyword === undefined) {
                anchor.keyword = keyword;
            } else {
                return undefined;
            }
        }
        if (fallback.length > 0) {
            const tree: CalcNode | undefined = this.parseCalculation(fallback);
            const type: NumericType | undefined = tree === undefined ? undefined : this.types.typeOf(tree, "length");
            if (tree === undefined || type === undefined || this.types.categoryOf(type) !== "length") {
                return undefined;
            }
            anchor.fallback = tree;
        }
        return anchor;
    }

    private sizeAsLength(node: CalcNode): CalcNode {
        if (node.kind === "leaf" || node.kind === "channel" || node.kind === "anchor") {
            return node.kind === "channel" ? { kind: "leaf", value: 0, unit: "px" } : node;
        }
        const children: Array<CalcNode> = node.children.map((child: CalcNode) => this.sizeAsLength(child));
        return node.kind === "round" ? { kind: "round", strategy: node.strategy, children } : { kind: "operation", operator: node.operator, children };
    }

    private parseFunction(node: FunctionNode, channels?: ReadonlySet<string>): CalcNode | undefined {
        const name: string = this.asciiCase.foldLower(this.escaping.unescape(node.name));
        const args: Array<Array<CssNode>> | undefined = this.splitArguments(node.children.toArray());
        if (args === undefined) {
            return undefined;
        }
        if (name === "calc") {
            return args.length === 1 ? this.parseCalculation(args[0], channels) : undefined;
        }
        if (name === "clamp") {
            return this.parseClamp(args, channels);
        }
        if (name === "round") {
            return this.parseRound(args, channels);
        }
        if (name === "log") {
            return args.length === 1 || args.length === 2 ? this.operation("log", args, channels) : undefined;
        }
        if (ONE_ARGUMENT.has(name)) {
            return args.length === 1 ? this.operation(name as CalcOperator, args, channels) : undefined;
        }
        if (TWO_ARGUMENTS.has(name)) {
            return args.length === 2 ? this.operation(name as CalcOperator, args, channels) : undefined;
        }
        if (LIST_ARGUMENTS.has(name)) {
            return this.operation(name as CalcOperator, args, channels);
        }
        return undefined;
    }

    private splitArguments(nodes: ReadonlyArray<CssNode>): Array<Array<CssNode>> | undefined {
        const args: Array<Array<CssNode>> = [[]];
        for (const node of nodes) {
            if (node.type === "Operator" && node.value.trim() === ",") {
                args.push([]);
            } else {
                args[args.length - 1].push(node);
            }
        }
        return args.some((arg: Array<CssNode>) => arg.length === 0) ? undefined : args;
    }

    private operation(operator: CalcOperator, args: ReadonlyArray<ReadonlyArray<CssNode>>, channels?: ReadonlySet<string>): CalcNode | undefined {
        const children: Array<CalcNode> = [];
        for (const arg of args) {
            const child: CalcNode | undefined = this.parseCalculation(arg, channels);
            if (child === undefined) {
                return undefined;
            }
            children.push(child);
        }
        return { kind: "operation", operator, children };
    }

    private parseClamp(args: ReadonlyArray<ReadonlyArray<CssNode>>, channels?: ReadonlySet<string>): CalcNode | undefined {
        // clamp(MIN, VAL, MAX) is max(MIN, min(VAL, MAX)), and none on either side removes that side (CSS Values 4 §10.2).
        if (args.length !== 3) {
            return undefined;
        }
        const center: CalcNode | undefined = this.parseCalculation(args[1], channels);
        const lower: CalcNode | undefined = this.isNone(args[0]) ? undefined : this.parseCalculation(args[0], channels);
        const upper: CalcNode | undefined = this.isNone(args[2]) ? undefined : this.parseCalculation(args[2], channels);
        if (center === undefined || (lower === undefined && !this.isNone(args[0])) || (upper === undefined && !this.isNone(args[2]))) {
            return undefined;
        }
        if (lower === undefined && upper === undefined) {
            return center;
        }
        if (upper === undefined) {
            return { kind: "operation", operator: "max", children: [lower as CalcNode, center] };
        }
        if (lower === undefined) {
            return { kind: "operation", operator: "min", children: [center, upper] };
        }
        return { kind: "operation", operator: "clamp", children: [lower, center, upper] };
    }

    private parseRound(args: ReadonlyArray<ReadonlyArray<CssNode>>, channels?: ReadonlySet<string>): CalcNode | undefined {
        const strategy: RoundingStrategy | undefined = this.strategyOf(args[0]);
        const values: ReadonlyArray<ReadonlyArray<CssNode>> = strategy === undefined ? args : args.slice(1);
        if (values.length !== 1 && values.length !== 2) {
            return undefined;
        }
        const a: CalcNode | undefined = this.parseCalculation(values[0], channels);
        if (a === undefined) {
            return undefined;
        }
        let b: CalcNode | undefined;
        if (values.length === 2) {
            b = this.parseCalculation(values[1], channels);
            if (b === undefined) {
                return undefined;
            }
        } else {
            // CSS Values 4 §10.3: B may be omitted, and defaults to 1, only when A is a <number>.
            const type: NumericType | undefined = this.types.typeOf(a);
            if (type === undefined || this.types.categoryOf(type) !== "number") {
                return undefined;
            }
            b = { kind: "leaf", value: 1, unit: "" };
        }
        return { kind: "round", strategy: strategy ?? "nearest", children: [a, b] };
    }

    private strategyOf(arg: ReadonlyArray<CssNode>): RoundingStrategy | undefined {
        const name: string | undefined = this.singleIdentifier(arg);
        return name !== undefined && ROUNDING_STRATEGIES.has(name) ? name as RoundingStrategy : undefined;
    }

    private isNone(arg: ReadonlyArray<CssNode>): boolean {
        return this.singleIdentifier(arg) === "none";
    }

    private singleIdentifier(arg: ReadonlyArray<CssNode>): string | undefined {
        const only: CssNode | undefined = arg.length === 1 ? arg[0] : undefined;
        return only !== undefined && only.type === "Identifier" ? this.asciiCase.foldLower(this.escaping.unescape(only.name)) : undefined;
    }

    private parseCalculation(nodes: ReadonlyArray<CssNode>, channels?: ReadonlySet<string>): CalcNode | undefined {
        // CSS Values 4 §10.8 and §10.10, "parse a calculation": values alternate with operators, * and / bind tighter than + and -.
        if (nodes.length % 2 === 0) {
            return undefined;
        }
        const values: Array<CalcNode> = [];
        const operators: Array<string> = [];
        for (let index: number = 0; index < nodes.length; index++) {
            if (index % 2 === 0) {
                const value: CalcNode | undefined = this.parseValue(nodes[index], channels);
                if (value === undefined) {
                    return undefined;
                }
                values.push(value);
            } else {
                const operator: string | undefined = this.operatorOf(nodes[index]);
                if (operator === undefined) {
                    return undefined;
                }
                operators.push(operator);
            }
        }
        const terms: Array<CalcNode> = [];
        const termOperators: Array<string> = [];
        let run: Array<CalcNode> = [values[0]];
        for (let index: number = 0; index < operators.length; index++) {
            const operator: string = operators[index];
            const right: CalcNode = values[index + 1];
            if (operator === "*") {
                run.push(right);
            } else if (operator === "/") {
                run.push({ kind: "operation", operator: "invert", children: [right] });
            } else {
                terms.push(this.product(run));
                termOperators.push(operator);
                run = [right];
            }
        }
        terms.push(this.product(run));
        const addends: Array<CalcNode> = [terms[0]];
        for (let index: number = 0; index < termOperators.length; index++) {
            const term: CalcNode = terms[index + 1];
            addends.push(termOperators[index] === "-" ? { kind: "operation", operator: "negate", children: [term] } : term);
        }
        return addends.length === 1 ? addends[0] : { kind: "operation", operator: "sum", children: addends };
    }

    private product(run: ReadonlyArray<CalcNode>): CalcNode {
        return run.length === 1 ? run[0] : { kind: "operation", operator: "product", children: run };
    }

    private operatorOf(node: CssNode): string | undefined {
        // CSS Values 4 §10.8: whitespace is required on both sides of + and -, and optional around * and /.
        if (node.type !== "Operator") {
            return undefined;
        }
        const operator: string = node.value.trim();
        if (operator === "*" || operator === "/") {
            return operator;
        }
        if ((operator === "+" || operator === "-") && /^\s/.test(node.value) && /\s$/.test(node.value)) {
            return operator;
        }
        return undefined;
    }

    private parseValue(node: CssNode, channels?: ReadonlySet<string>): CalcNode | undefined {
        switch (node.type) {
            case "Number":
                return { kind: "leaf", value: this.numberOf(node.value), unit: "" };
            case "Percentage":
                return { kind: "leaf", value: this.numberOf(node.value), unit: "%" };
            case "Dimension": {
                const unit: string = this.asciiCase.foldLower(this.escaping.unescape(node.unit));
                return this.types.ofUnit(unit) === undefined ? undefined : { kind: "leaf", value: this.numberOf(node.value), unit };
            }
            case "Identifier": {
                const name: string = this.asciiCase.foldLower(this.escaping.unescape(node.name));
                // CSS Color 5 §5.3: a component named as a numeric constant "will be shadowed by the numeric constant".
                const constant: number | undefined = CONSTANTS.get(name);
                if (constant !== undefined) {
                    return { kind: "leaf", value: constant, unit: "" };
                }
                return channels !== undefined && (channels.has(name) || channels === ColorSpaces.PROFILE_CHANNELS) ? { kind: "channel", name } : undefined;
            }
            case "Parentheses":
                return this.parseCalculation(node.children.toArray(), channels);
            case "Function": {
                const name: string = this.asciiCase.foldLower(this.escaping.unescape(node.name));
                if (name === ANCHOR_SIZE) {
                    return this.parseAnchorSize(node);
                }
                return this.isMathFunction(name) ? this.parseFunction(node, channels) : undefined;
            }
            default:
                return undefined;
        }
    }

    private numberOf(text: string): number {
        // CSS Values 4 §10.9.1: 0, +0 and -0 are all the unsigned zero, which counts as 0⁺.
        const value: number = Number(text);
        return value === 0 ? 0 : value;
    }
}
