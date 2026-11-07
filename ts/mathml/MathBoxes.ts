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
import type { ContainerQuery, DeclaredValue } from "../css/Stylesheet.js";
import type { CssValue } from "../css/values/CssValue.js";
import { SourceElement } from "../parse/SourceElement.js";
import type { BoxNode, ElementBox, Placement, TextSequence } from "../pdf/BoxTree.js";
import type { Cascade } from "../pdf/Cascade.js";
import type { ComputedStyle } from "../pdf/ComputedStyle.js";
import { ContentValues } from "../pdf/ContentValues.js";
import type { CrossReferences } from "../pdf/CrossReferences.js";
import type { DisplayType } from "../pdf/DisplayTypes.js";
import { DisplayTypes } from "../pdf/DisplayTypes.js";
import type { Size } from "../pdf/PageCanvas.js";
import { StyleComputer } from "../pdf/StyleComputer.js";
import type { MathElement } from "./MathMarkup.js";
import { MathMarkup } from "./MathMarkup.js";
import { MathOperators } from "./MathOperators.js";

const MATH_BOX: DisplayType = { outer: "block", inner: "math", listItem: false };
const MATH_WHITE_SPACE: RegExp = /[ \t\n\r]+/g;
const APPLY_FUNCTION: string = "\u2061";
const INVISIBLE_TIMES: string = "\u2062";
const NO_BREAK: string = "\u00A0";
const INFIX: ReadonlyMap<string, string> = new Map<string, string>([
    ["plus", "+"], ["times", INVISIBLE_TIMES], ["compose", "∘"], ["and", "∧"], ["or", "∨"], ["union", "∪"], ["intersect", "∩"],
    ["cartesianproduct", "×"], ["eq", "="], ["gt", ">"], ["lt", "<"], ["geq", "≥"], ["leq", "≤"], ["subset", "⊆"], ["prsubset", "⊂"],
    ["divide", "/"], ["minus", "−"], ["rem", "mod"], ["implies", "⇒"], ["equivalent", "≡"], ["neq", "≠"], ["approx", "≃"],
    ["factorof", "|"], ["tendsto", "→"], ["vectorproduct", "×"], ["scalarproduct", "."], ["outerproduct", "⊗"], ["in", "∈"],
    ["notin", "∉"], ["notsubset", "⊈"], ["notprsubset", "⊄"], ["setdiff", "∖"]
]);
const SUMS: ReadonlySet<string> = new Set<string>(["plus", "minus"]);
const PRODUCTS: ReadonlySet<string> = new Set<string>(["times", "divide"]);
const NEGATION: string = "negation";
const ARITHMETIC: ReadonlySet<string> = new Set<string>([...SUMS, ...PRODUCTS, NEGATION]);
const BIG: ReadonlyMap<string, string> = new Map<string, string>([["sum", "∑"], ["product", "∏"], ["and", "⋀"], ["union", "⋃"], ["intersect", "⋂"]]);
const PREFIX: ReadonlyMap<string, string> = new Map<string, string>([["not", "¬"], ["minus", "−"]]);
const FENCED: ReadonlyMap<string, readonly [string, string]> = new Map<string, readonly [string, string]>([
    ["abs", ["|", "|"]], ["card", ["|", "|"]], ["floor", ["⌊", "⌋"]], ["ceiling", ["⌈", "⌉"]], ["mean", ["⟨", "⟩"]]
]);
const ELEMENTARY: ReadonlySet<string> = new Set<string>([
    "sin", "cos", "tan", "sec", "csc", "cot", "sinh", "cosh", "tanh", "sech", "csch", "coth", "arcsin", "arccos", "arctan", "arccosh", "arccot", "arccoth",
    "arccsc", "arccsch", "arcsec", "arcsech", "arcsinh", "arctanh", "ln", "determinant", "log"
]);
const NAMES: ReadonlyMap<string, string> = new Map<string, string>([["determinant", "det"], ["divergence", "div"]]);
const SYMBOL_FUNCTIONS: ReadonlyMap<string, string> = new Map<string, string>([["sdev", "σ"], ["real", "ℜ"], ["imaginary", "ℑ"]]);
const CONSTANTS: ReadonlyMap<string, string> = new Map<string, string>([
    ["exponentiale", "e"], ["imaginaryi", "i"], ["notanumber", "NaN"], ["true", "true"], ["false", "false"], ["pi", "π"], ["eulergamma", "γ"],
    ["infinity", "∞"], ["emptyset", "∅"], ["ident", "id"]
]);
const SETS: ReadonlyMap<string, string> = new Map<string, string>([
    ["integers", "Z"], ["reals", "R"], ["rationals", "Q"], ["naturalnumbers", "N"], ["complexes", "C"], ["primes", "P"]
]);
const QUALIFIERS: ReadonlySet<string> = new Set<string>(["lowlimit", "uplimit", "condition", "domainofapplication", "degree", "momentabout", "logbase"]);
const OPERATORS: ReadonlySet<string> = new Set<string>([
    ...INFIX.keys(), ...BIG.keys(), ...PREFIX.keys(), ...FENCED.keys(), ...ELEMENTARY, ...SYMBOL_FUNCTIONS.keys(), ...CONSTANTS.keys(), ...SETS.keys(),
    "gcd", "lcm", "xor", "selector", "min", "max", "median", "mode", "variance", "quotient", "power", "root", "factorial", "conjugate", "arg", "exp",
    "transpose", "inverse", "domain", "codomain", "image", "divergence", "grad", "curl", "laplacian", "moment", "int", "diff", "partialdiff", "forall",
    "exists", "limit"
]);
const CONTAINERS: ReadonlySet<string> = new Set<string>(["set", "list", "vector", "matrix", "matrixrow", "interval", "lambda", "piecewise", "piece", "otherwise"]);
const INTERVAL_CLOSURES: ReadonlyMap<string, string> = new Map<string, string>([
    ["interval_cc", "closed"], ["interval_oc", "open-closed"], ["interval_co", "closed-open"], ["interval_oo", "open"]
]);
const STRUCTURE: ReadonlySet<string> = new Set<string>(["ci", "cn", "csymbol", "cs", "apply", "bind", "bvar", "share", "cerror", "cbytes", "sep", ...QUALIFIERS]);
const TOKEN_ELEMENTS: ReadonlySet<string> = new Set<string>(["ci", "cn", "csymbol", "cs"]);
const MATH: string = "display: block math; font-size: math; ";
const SCRIPT: string = MATH + "math-depth: add(1); math-style: compact";
const INDEX: string = MATH + "math-depth: add(2); math-style: compact";
const NUMERATOR: string = MATH + "math-depth: auto-add; math-style: compact";
const DENOMINATOR: string = NUMERATOR + "; math-shift: compact";
const IDENTIFIER: string = MATH + "text-transform: math-auto";
const TABLE: string = "display: inline-table; math-style: compact; font-size: math";
const ROW: string = "display: table-row; font-size: math";
const CELL: string = "display: table-cell; text-align: center; padding: 0.5ex 0.4em; font-size: math";
const LEFT_CELL: string = CELL + "; text-align: left";
const INTEGER: RegExp = /^[0-9]+$/;

export class MathBoxes {

    readonly elements: WeakMap<ElementBox, MathElement> = new WeakMap<ElementBox, MathElement>();
    private readonly markup: MathMarkup;
    private readonly cascade: Cascade;
    private readonly computer: StyleComputer;
    private readonly references: CrossReferences;
    private readonly displays: DisplayTypes = new DisplayTypes();
    private readonly contentValues: ContentValues = new ContentValues();
    private readonly dictionary: MathOperators = new MathOperators();
    private readonly arithmetic: WeakMap<ElementBox, string> = new WeakMap<ElementBox, string>();
    private readonly styles: WeakMap<ComputedStyle, Map<string, ComputedStyle>> = new WeakMap<ComputedStyle, Map<string, ComputedStyle>>();
    private viewport: Size = { width: 0, height: 0 };
    private root?: ComputedStyle;
    private rootElement?: SourceElement;
    private nextGroup: number = 0;

    constructor(markup: MathMarkup, cascade: Cascade, computer: StyleComputer, references: CrossReferences) {
        this.markup = markup;
        this.cascade = cascade;
        this.computer = computer;
        this.references = references;
    }

    build(element: SourceElement, style: ComputedStyle, viewport: Size, root: ComputedStyle): ElementBox | undefined {
        // The boxes of a formula, each MathML element with the style the formula's cascade gives it and its MathML data kept
        // here; what MathML defines as equivalent markup is built as boxes, the source tree staying as it is.
        this.viewport = viewport;
        this.root = root;
        this.rootElement = element;
        return this.box(element, style, viewport, root);
    }

    private linked(box: ElementBox, element: SourceElement, style: ComputedStyle): void {
        // MathML 4 §2.1.6: a link inside the formula goes to a place in the document or to a URI, as the links of the document's
        // boxes do; the formula's own link is on the box that shows it.
        const link: string | undefined = element === this.rootElement ? undefined : this.cascade.linkOf(element, undefined, style.values[PropertyTable.LINK]);
        if (link === undefined) {
            return;
        }
        const destination: string | undefined = this.references.link(link, this.cascade.linkTarget(link));
        if (destination === undefined) {
            box.linkUri = link;
        } else {
            box.linkDestination = destination;
        }
    }

    private placement(style: ComputedStyle): Placement {
        // MathML Core §2.2.2: float "does not create floating of elements" in math "and does not take them out-of-flow", footnote
        // floats included; §3.1.2 and GCPM 3 §1.2.1: positioned children and running elements leave the flow.
        const position: CssValue | undefined = style.values["position"];
        if (position !== undefined && position.kind === "function" && position.name === "running") {
            return "running";
        }
        if (position !== undefined && position.kind === "ident" && (position.lower === "absolute" || position.lower === "fixed")) {
            return position.lower === "absolute" ? "absolute" : "fixed";
        }
        return "in-flow";
    }

    private childBox(element: SourceElement, parent: ComputedStyle): ElementBox | undefined {
        return this.box(element, this.styleOf(element, parent, this.viewport, this.root as ComputedStyle), this.viewport, this.root as ComputedStyle);
    }

    private box(element: SourceElement, style: ComputedStyle, viewport: Size, root: ComputedStyle): ElementBox | undefined {
        const display: DisplayType = this.displays.parse(style.values["display"]);
        if (display.box === "none") {
            return undefined;
        }
        const local: string = element.getLocalName();
        if (this.isContent(local)) {
            return this.contentBox(element, style);
        }
        const items: Array<CssValue> | undefined = this.contentValues.items(style.values["content"]);
        const replaced: boolean = items !== undefined && this.contentValues.isReplacement(items);
        const box: ElementBox = {
            kind: "box", element, style, display, placement: element === this.rootElement ? "in-flow" : this.placement(style), replaced, hasStartEdge: true, hasEndEdge: true,
            usedPage: "", startPage: "", endPage: "", children: []
        };
        this.linked(box, element, style);
        const data: MathElement | undefined = this.data(element, local, display, style, viewport, root);
        if (data !== undefined) {
            this.elements.set(box, data);
        }
        const spans: readonly [number, number] | undefined = this.markup.spans(element);
        if (spans !== undefined) {
            box.spans = spans;
        }
        if (replaced && items !== undefined) {
            // MathML 4 §3.2.1.1: mglyph shows its image, as a replaced element does.
            box.children = [{ kind: "deferred", value: items[0], style: this.anonymous(style) }];
            return box;
        }
        if (MathMarkup.TOKENS.has(local)) {
            box.children = this.tokenChildren(element, style, viewport, root);
            return box;
        }
        const children: Array<ElementBox> = [];
        for (const child of element.getChildren()) {
            if (!this.markup.isMath(child)) {
                continue;
            }
            const built: ElementBox | undefined = this.box(child, this.styleOf(child, style, viewport, root), viewport, root);
            if (built !== undefined) {
                children.push(built);
            }
        }
        box.children = this.arranged(element, local, box, children);
        return box;
    }

    private data(element: SourceElement, local: string, display: DisplayType, style: ComputedStyle, viewport: Size, root: ComputedStyle): MathElement | undefined {
        // MathML 4 §3.5: the table, its rows and its cells keep the attributes that their layout reads.
        if (local === "mtable") {
            return this.markup.tableElement(element);
        }
        if (local === "mtr") {
            return { name: "mtr" };
        }
        if (local === "mtd") {
            return this.markup.cellElement(element) ?? { name: "mtd" };
        }
        if (display.inner !== "math") {
            return undefined;
        }
        return this.markup.element(element, (text: string): CssValue | undefined =>
            this.computer.attributeLength(text, style, StyleComputer.input(new Map<string, DeclaredValue>(), viewport, StyleComputer.NO_CONTAINERS, undefined, root, element)));
    }

    private arranged(element: SourceElement, local: string, box: ElementBox, children: Array<ElementBox>): Array<BoxNode> {
        if (local === "mtd") {
            // MathML Core §3.5.3: "The <mtd> element generates an anonymous <mrow> box."
            return [this.anonymousBox(box.style, "mrow", children)];
        }
        if (local === "mfenced") {
            return this.fenced(element, box.style, children);
        }
        if (MathMarkup.STACKS.has(local)) {
            return this.stacked(local, box.style, children);
        }
        return children;
    }

    private fenced(element: SourceElement, style: ComputedStyle, args: Array<ElementBox>): Array<BoxNode> {
        // MathML 4 §3.3.8.2: an mfenced element "is equivalent to" an mrow of the opening fence, the arguments with separators
        // between them in an inner mrow, and the closing fence; these are boxes of the element's own.
        const [open, close, separators]: readonly [string, string, ReadonlyArray<string>] = this.markup.fences(element);
        const nodes: Array<BoxNode> = [this.operator(style, open)];
        if (args.length === 1) {
            nodes.push(args[0]);
        } else if (args.length > 1) {
            const row: Array<ElementBox> = [];
            args.forEach((arg: ElementBox, index: number) => {
                if (index > 0 && separators.length > 0) {
                    row.push(this.operator(style, separators[Math.min(index, separators.length) - 1]));
                }
                row.push(arg);
            });
            nodes.push(this.anonymousBox(style, "mrow", row));
        }
        nodes.push(this.operator(style, close));
        return nodes;
    }

    private stacked(local: string, style: ComputedStyle, children: Array<ElementBox>): Array<BoxNode> {
        // MathML 4 §3.6: the children of mstack, mlongdiv (after its divisor and result) and msgroup other than msrow, msgroup,
        // mscarries and msline "are treated as if implicitly surrounded by an msrow"; §3.6.4.1: the numbers of a row in digits.
        const skipped: number = local === "mlongdiv" ? 2 : 0;
        return children.map((child: ElementBox, index: number): ElementBox => {
            const name: string = this.elements.get(child)?.name ?? "";
            if (index < skipped - 1) {
                return child;
            }
            if (index === skipped - 1) {
                // The result of a long division can be "part of the dividend's mstack", where its digits take columns.
                return name === "msrow" ? this.splitRow(child) : this.anonymousBox(style, "msrow", this.digits([child]));
            }
            if (MathMarkup.STACK_ITEMS.has(name)) {
                return name === "msrow" ? this.splitRow(child) : child;
            }
            return this.anonymousBox(style, "msrow", this.digits([child]));
        });
    }

    private splitRow(row: ElementBox): ElementBox {
        row.children = this.digits(row.children.filter((node: BoxNode): node is ElementBox => node.kind === "box"));
        return row;
    }

    private digits(cells: ReadonlyArray<ElementBox>): Array<ElementBox> {
        // §3.6.4.1: "the number is split into its digits and the digits are placed into successive columns", each digit a box
        // of the mn; an mstyle "is treated as if its children were directly the children of the msrow".
        const result: Array<ElementBox> = [];
        for (const cell of cells) {
            const data: MathElement | undefined = this.elements.get(cell);
            if (data?.name === "mstyle") {
                cell.children = this.digits(cell.children.filter((node: BoxNode): node is ElementBox => node.kind === "box"));
                result.push(cell);
                continue;
            }
            const text: string = cell.children.map((node: BoxNode) => node.kind === "text" ? node.text : "").join("").replace(MATH_WHITE_SPACE, " ").trim();
            const characters: Array<string> = data?.name === "mn" ? [...text] : [];
            if (characters.length <= 1 || data === undefined) {
                result.push(cell);
                continue;
            }
            const group: number = this.nextGroup++;
            for (const character of characters) {
                const piece: ElementBox = { ...cell, children: [this.text(cell.style, character)] };
                this.elements.set(piece, { ...data, digitGroup: group });
                result.push(piece);
            }
        }
        return result;
    }

    private tokenChildren(element: SourceElement, style: ComputedStyle, viewport: Size, root: ComputedStyle): Array<BoxNode> {
        // MathML 4 §3.2.2: the characters of mathvariant, and §3.2.9: ms between its quotes, with the quotes inside escaped and
        // its white space collapsed as in §2.1.7; an mglyph inside the token is a box of its own.
        const nodes: Array<BoxNode> = [];
        let text: string = "";
        const flush: () => void = (): void => {
            if (text.length > 0) {
                nodes.push(this.text(style, this.markup.variantText(element, text), element.getLanguage()));
                text = "";
            }
        };
        for (const node of element.getContent()) {
            if (node instanceof TextNode) {
                text += node.getValue();
            } else if (node instanceof SourceElement && this.markup.isMath(node)) {
                flush();
                const built: ElementBox | undefined = this.box(node, this.styleOf(node, style, viewport, root), viewport, root);
                if (built !== undefined) {
                    nodes.push(built);
                }
            }
        }
        flush();
        if (element.getLocalName() !== "ms") {
            return nodes;
        }
        const quotes: readonly [string, string] = this.markup.quotes(element);
        const inner: string = nodes.map((node: BoxNode) => node.kind === "text" ? node.text : "").join("").replace(MATH_WHITE_SPACE, " ").trim();
        return [this.text(style, quotes[0] + this.markup.escaped(inner, quotes) + quotes[1], element.getLanguage())];
    }

    private styleOf(element: SourceElement, parent: ComputedStyle, viewport: Size, root: ComputedStyle): ComputedStyle {
        // The styles of the formula's elements come from the formula's cascade, with no container queries of their own.
        const cascaded: Map<string, DeclaredValue> = this.cascade.element(element, (queries: ReadonlyArray<ContainerQuery>) =>
            this.computer.containersHold(queries, StyleComputer.NO_CONTAINERS, viewport));
        return this.computer.compute(StyleComputer.input(cascaded, viewport, StyleComputer.NO_CONTAINERS, parent, root, element));
    }

    private isContent(local: string): boolean {
        // MathML 4 chapter 4: the elements of Content MathML, which render as the presentation that its samples give.
        return OPERATORS.has(local) || CONTAINERS.has(local) || STRUCTURE.has(local);
    }

    private contentBox(element: SourceElement, style: ComputedStyle): ElementBox {
        const local: string = element.getLocalName();
        switch (local) {
            case "ci":
            case "csymbol":
                return this.identifier(element, style);
            case "cn":
                return this.number(element, style);
            case "cs":
                return this.string(element, style);
            case "apply":
            case "bind":
                return this.apply(element, style);
            case "share":
                return this.share(element, style);
            case "cerror":
                return this.error(element, style);
            case "set":
            case "list":
            case "vector":
            case "matrix":
            case "interval":
            case "piecewise":
                return this.container(element, style, local, this.mathChildren(element), (element.getAttributeValue("closure") ?? "closed").trim());
            case "lambda": {
                const [bvars, qualifiers, args]: readonly [Array<SourceElement>, Map<string, SourceElement>, Array<SourceElement>] =
                    this.split(this.mathChildren(element), false);
                return this.binding(element, style, "λ", bvars, qualifiers, args);
            }
            default:
                return this.standalone(element, style, local);
        }
    }

    private standalone(element: SourceElement, style: ComputedStyle, local: string): ElementBox {
        // §4.3.9: the constants render as identifiers, the number sets double-struck; an operator element alone renders its
        // name (the image of §4.3.7.4 shows sin); a qualifier renders what it holds; cbytes and matrixrow render nothing.
        const constant: string | undefined = CONSTANTS.get(local);
        if (constant !== undefined) {
            return this.own(element, style, "mi", [this.text(this.derivedStyle(style, element, IDENTIFIER), constant)]);
        }
        const set: string | undefined = SETS.get(local);
        if (set !== undefined) {
            return this.own(element, style, "mi", [this.text(style, this.markup.variant(set, "double-struck"))]);
        }
        if (OPERATORS.has(local)) {
            return this.own(element, style, "mi", [this.text(style, NAMES.get(local) ?? local)]);
        }
        if (local === "cbytes" || local === "matrixrow" || local === "sep") {
            return this.own(element, style, "mrow", []);
        }
        return this.own(element, style, "mrow", this.children(element, style));
    }

    private identifier(element: SourceElement, style: ComputedStyle): ElementBox {
        // §4.2.2.3 and §4.2.3.3: presentation content is used as it is; text renders "as if it were the content of an mi".
        if (this.mathChildren(element).length > 0) {
            return this.own(element, style, "mrow", this.children(element, style));
        }
        return this.own(element, style, "mi", [this.text(style, this.collapsed(this.textOf(element)), element.getLanguage())]);
    }

    private number(element: SourceElement, style: ComputedStyle): ElementBox {
        // §4.2.1.1: the text renders as an mn, with the variants of §4.2.1.3 for base, the hexdouble and the parts that sep
        // separates; presentation content is used as it is.
        if (element.getChildren().some((child: SourceElement) => this.markup.isMath(child) && child.getLocalName() !== "sep")) {
            return this.own(element, style, "mrow", this.children(element, style));
        }
        const parts: Array<string> = this.numberParts(element);
        const type: string = (element.getAttributeValue("type") ?? "real").trim();
        const base: string | undefined = element.getAttributeValue("base")?.trim();
        const mn: (text: string) => ElementBox = (text: string): ElementBox => this.token(style, "mn", text);
        switch (type) {
            case "hexdouble":
                return this.own(element, style, "mn", [this.text(style, "0x" + parts[0])]);
            case "e-notation":
                return this.own(element, style, "mn", [this.text(style, parts.join("e"))]);
            case "rational":
                return this.own(element, style, "mrow", [mn(parts[0] ?? ""), this.operator(style, "/"), mn(parts[1] ?? "")]);
            case "complex-cartesian":
                return this.own(element, style, "mrow", [mn(parts[0] ?? ""), this.operator(style, "+"), mn(parts[1] ?? ""), this.operator(style, INVISIBLE_TIMES),
                    this.mi(style, element, "i")]);
            case "complex-polar": {
                const script: ComputedStyle = this.derivedStyle(style, element, SCRIPT);
                return this.own(element, style, "mrow", [mn(parts[0] ?? ""), this.operator(style, INVISIBLE_TIMES), this.anonymousBox(style, "msup", [this.mi(style, element,
                    "e"), this.anonymousBox(script, "mrow", [this.mi(script, element, "i"), this.operator(script, INVISIBLE_TIMES), this.token(script, "mn", parts[1] ?? "")])])]);
            }
            default:
                break;
        }
        if (base !== undefined && base !== "10") {
            const script: ComputedStyle = this.derivedStyle(style, element, SCRIPT);
            return this.own(element, style, "msub", [mn(parts.join("")), this.token(script, "mn", base)]);
        }
        return this.own(element, style, "mn", [this.text(style, parts.join(""))]);
    }

    private string(element: SourceElement, style: ComputedStyle): ElementBox {
        // §4.2.4: cs renders as an ms, whose content "does not undergo white space normalization".
        const quotes: readonly [string, string] = this.markup.quotes(element);
        return this.own(element, style, "ms", [this.text(style, quotes[0] + this.markup.escaped(this.textOf(element), quotes) + quotes[1])]);
    }

    private share(element: SourceElement, style: ComputedStyle): ElementBox {
        // §4.2.7.4: "using the rendering of the element referenced by the src attribute".
        const source: string = element.getAttributeValue("src") ?? "";
        const id: string = source.startsWith("#") ? source.substring(1) : source;
        const target: SourceElement | undefined = id.length === 0 ? undefined : this.byId(this.top(element), id);
        if (target === undefined || target === element) {
            return this.own(element, style, "mrow", []);
        }
        const built: ElementBox | undefined = this.childBox(target, style);
        return this.own(element, style, "mrow", built === undefined ? [] : [built]);
    }

    private error(element: SourceElement, style: ComputedStyle): ElementBox {
        // §4.2.9: "an merror expression whose first child is a presentation of the error symbol", as the sample's mtext with
        // a colon and a no-break space, "and whose subsequent children are the default presentations of the remaining children".
        const children: Array<SourceElement> = this.mathChildren(element);
        const parts: Array<BoxNode> = [];
        if (children.length > 0) {
            parts.push(this.token(style, "mtext", this.collapsed(this.textOf(children[0])) + ":" + NO_BREAK));
        }
        for (const child of children.slice(1)) {
            parts.push(this.render(child, style));
        }
        return this.own(element, style, "merror", parts);
    }

    private apply(element: SourceElement, style: ComputedStyle): ElementBox {
        const children: Array<SourceElement> = this.mathChildren(element);
        const head: SourceElement | undefined = children[0];
        const [bvars, qualifiers, args]: readonly [Array<SourceElement>, Map<string, SourceElement>, Array<SourceElement>] =
            this.split(children.slice(1), head !== undefined);
        const operator: string | undefined = head === undefined ? undefined : this.operatorOf(head);
        if (element.getLocalName() === "bind") {
            return this.bind(element, style, head, operator, bvars, args);
        }
        if (operator === "forall" || operator === "exists") {
            return this.binding(element, style, operator === "forall" ? "∀" : "∃", bvars, qualifiers, args);
        }
        if (operator === "lambda") {
            return this.binding(element, style, "λ", bvars, qualifiers, args);
        }
        if (operator !== undefined && head !== undefined && CONTAINERS.has(operator)) {
            // Appendix E.3: a csymbol of a constructor's symbol applied to arguments is that constructor with them as children.
            return this.container(element, style, operator, children.slice(1), INTERVAL_CLOSURES.get(this.collapsed(this.textOf(head))) ?? "closed");
        }
        if (operator === undefined) {
            return this.application(element, style, head, bvars, qualifiers, args);
        }
        const big: string | undefined = BIG.get(operator);
        if (big !== undefined && (bvars.length > 0 || qualifiers.size > 0 || operator === "sum" || operator === "product")) {
            return this.large(element, style, big, bvars, qualifiers, args);
        }
        if (operator === "minus" && args.length === 1) {
            return this.prefix(element, style, operator, "−", args[0]);
        }
        const infix: string | undefined = INFIX.get(operator);
        if (infix !== undefined) {
            return this.infix(element, style, operator, infix, args, head);
        }
        const prefix: string | undefined = PREFIX.get(operator);
        if (prefix !== undefined && args.length === 1) {
            return this.prefix(element, style, operator, prefix, args[0]);
        }
        const fences: readonly [string, string] | undefined = FENCED.get(operator);
        if (fences !== undefined) {
            return this.own(element, style, "mrow", [this.operator(style, fences[0]), ...this.separated(style, args, ","), this.operator(style, fences[1])]);
        }
        return this.special(element, style, operator, bvars, qualifiers, args);
    }

    private special(element: SourceElement, style: ComputedStyle, operator: string, bvars: ReadonlyArray<SourceElement>, qualifiers: ReadonlyMap<string, SourceElement>,
        args: ReadonlyArray<SourceElement>): ElementBox {
        const first: SourceElement | undefined = args[0];
        switch (operator) {
            case "factorial":
                return this.postfix(element, style, "!", first);
            case "power":
                return this.script(element, style, "msup", first, args[1]);
            case "exp":
                return this.own(element, style, "msup", [this.mi(style, element, "e"), this.scriptBox(first, style, element)]);
            case "transpose":
                return this.own(element, style, "msup", [this.base(first, style), this.mi(this.derivedStyle(style, element, SCRIPT), element, "T")]);
            case "inverse": {
                const script: ComputedStyle = this.derivedStyle(style, element, SCRIPT);
                return this.own(element, style, "msup", [this.base(first, style), this.anonymousBox(script, "mrow", [this.operator(script, "("), this.token(script, "mn",
                    "-1"), this.operator(script, ")")])]);
            }
            case "conjugate":
                return this.own(element, style, "mover", [this.optional(first, style), this.operator(this.derivedStyle(style, element, SCRIPT), "¯")]);
            case "root":
                return this.radical(element, style, qualifiers, args);
            case "quotient":
                return this.own(element, style, "mrow", [this.operator(style, "⌊"), this.divided(first, style, SUMS), this.operator(style, "/"),
                    this.divided(args[1], style, ARITHMETIC), this.operator(style, "⌋")]);
            case "selector": {
                const script: ComputedStyle = this.derivedStyle(style, element, SCRIPT);
                return this.own(element, style, "msub", [this.base(first, style), this.anonymousBox(script, "mrow", this.separated(script, args.slice(1), ","))]);
            }
            case "min":
            case "max":
                return this.own(element, style, "mrow", [this.mi(style, element, operator), this.braces(style, bvars, qualifiers, args)]);
            case "variance":
                return this.function(element, style, this.anonymousBox(style, "msup", [this.operator(style, "σ"), this.token(this.derivedStyle(style, element, SCRIPT),
                    "mn", "2")]), args, true);
            case "laplacian":
            case "divergence":
            case "grad":
            case "curl":
                return this.calculus(element, style, operator, bvars, args);
            case "moment":
                return this.moment(element, style, qualifiers, args);
            case "log":
                return this.logarithm(element, style, qualifiers, args);
            case "int":
                return this.integral(element, style, bvars, qualifiers, args);
            case "diff":
                return this.derivative(element, style, bvars, args);
            case "partialdiff":
                return this.partial(element, style, bvars, qualifiers, args);
            case "limit":
                return this.limit(element, style, bvars, qualifiers, args);
            default:
                break;
        }
        const symbol: string | undefined = SYMBOL_FUNCTIONS.get(operator);
        const head: ElementBox = symbol === undefined ? this.mi(style, element, NAMES.get(operator) ?? operator) : this.operator(style, symbol);
        if (qualifiers.size > 0 || bvars.length > 0) {
            return this.qualified(element, style, head, bvars, qualifiers, args);
        }
        return this.function(element, style, head, args, !ELEMENTARY.has(operator));
    }

    private application(element: SourceElement, style: ComputedStyle, head: SourceElement | undefined, bvars: ReadonlyArray<SourceElement>,
        qualifiers: ReadonlyMap<string, SourceElement>, args: ReadonlyArray<SourceElement>): ElementBox {
        // §4.2.5.2: F, the function application operator, then (A1, ..., An); §4.3.5.4: a compound function is put in
        // parentheses, as (f∘g) is.
        let shown: ElementBox = this.anonymousBox(style, "mrow", []);
        if (head !== undefined) {
            shown = this.isToken(head) ? this.render(head, style) : this.parenthesized(style, this.render(head, style));
        }
        if (qualifiers.size > 0 || bvars.length > 0) {
            return this.qualified(element, style, shown, bvars, qualifiers, args);
        }
        return this.function(element, style, shown, args, true);
    }

    private bind(element: SourceElement, style: ComputedStyle, head: SourceElement | undefined, operator: string | undefined, bvars: ReadonlyArray<SourceElement>,
        args: ReadonlyArray<SourceElement>): ElementBox {
        // §4.2.6.4: B x1, ..., xn . S, B the binder's own symbol, as §4.2.6 renders quant1 forall: ∀x . x+y=y+x.
        let binder: ElementBox = head === undefined ? this.anonymousBox(style, "mrow", []) : this.render(head, style);
        if (operator === "forall" || operator === "exists") {
            binder = this.operator(style, operator === "forall" ? "∀" : "∃");
        } else if (operator === "lambda") {
            binder = this.mi(style, element, "λ");
        }
        return this.own(element, style, "mrow", [binder, this.anonymousBox(style, "mrow", this.joined(style, bvars.map((bvar: SourceElement) => this.variable(bvar, style)),
            ",")), this.operator(style, "."), ...args.map((arg: SourceElement) => this.render(arg, style))]);
    }

    private binding(element: SourceElement, style: ComputedStyle, symbol: string, bvars: ReadonlyArray<SourceElement>, qualifiers: ReadonlyMap<string, SourceElement>,
        args: ReadonlyArray<SourceElement>): ElementBox {
        // §4.3.10.1 and §4.3.10.2: ∀x.(body), ∃x.(body) and λx.(body); a domain or a condition joins the body with ∧, as the
        // Strict equivalent of §4.3.10.1 shows.
        const body: Array<BoxNode> = [];
        const domain: SourceElement | undefined = qualifiers.get("domainofapplication");
        const condition: SourceElement | undefined = qualifiers.get("condition");
        if (domain !== undefined && symbol !== "λ") {
            body.push(this.anonymousBox(style, "mrow", [...this.joined(style, bvars.map((bvar: SourceElement) => this.variable(bvar, style)), ","), this.operator(style, "∈"),
                this.render(this.only(domain), style)]), this.operator(style, "∧"));
        } else if (condition !== undefined) {
            body.push(this.render(this.only(condition), style), this.operator(style, "∧"));
        }
        body.push(...args.map((arg: SourceElement) => this.render(arg, style)));
        const head: ElementBox = symbol === "λ" ? this.mi(style, element, symbol) : this.operator(style, symbol);
        return this.own(element, style, "mrow", [head, ...this.joined(style, bvars.map((bvar: SourceElement) => this.variable(bvar, style)), ","), this.operator(style, "."),
            this.parenthesized(style, this.anonymousBox(style, "mrow", body))]);
    }

    private infix(element: SourceElement, style: ComputedStyle, operator: string, symbol: string, args: ReadonlyArray<SourceElement>, head: SourceElement | undefined): ElementBox {
        // §4.2.5.1: an apply "could be surrounded by parentheses ... without changing its meaning"; the samples add them only
        // where the formula would read otherwise, as (F+G)(x), and never around relations or logical operands.
        const above: boolean = operator === "tendsto" && head?.getAttributeValue("type") === "above";
        const children: Array<BoxNode> = [];
        args.forEach((arg: SourceElement, index: number) => {
            if (index > 0) {
                children.push(this.operator(style, symbol));
            }
            let operand: ElementBox = this.render(arg, style);
            const inner: string = this.arithmetic.get(operand) ?? "";
            if ((PRODUCTS.has(operator) && SUMS.has(inner)) || (index > 0 && ((operator === "minus" && SUMS.has(inner))
                || (operator === "divide" && PRODUCTS.has(inner)) || (inner === NEGATION && (SUMS.has(operator) || PRODUCTS.has(operator)))))) {
                operand = this.parenthesized(style, operand);
            }
            if (above && index === args.length - 1) {
                // §4.3.6.3: tendsto type above raises a + over the limit.
                operand = this.anonymousBox(style, "msup", [operand, this.operator(this.derivedStyle(style, element, SCRIPT), "+")]);
            }
            children.push(operand);
        });
        const box: ElementBox = this.own(element, style, "mrow", children);
        if (SUMS.has(operator) || PRODUCTS.has(operator)) {
            this.arithmetic.set(box, operator);
        }
        return box;
    }

    private prefix(element: SourceElement, style: ComputedStyle, operator: string, symbol: string, arg: SourceElement): ElementBox {
        // −(a + b): a negated sum or product keeps its parentheses, which the formula needs.
        const box: ElementBox = this.own(element, style, "mrow", [this.operator(style, symbol), operator === "minus" ? this.grouped(arg, style) : this.render(arg, style)]);
        if (operator === "minus") {
            this.arithmetic.set(box, NEGATION);
        }
        return box;
    }

    private postfix(element: SourceElement, style: ComputedStyle, symbol: string, arg: SourceElement | undefined): ElementBox {
        return this.own(element, style, "mrow", [this.base(arg, style), this.operator(style, symbol)]);
    }

    private grouped(arg: SourceElement, style: ComputedStyle): ElementBox {
        const box: ElementBox = this.render(arg, style);
        return this.arithmetic.has(box) ? this.parenthesized(style, box) : box;
    }

    private base(arg: SourceElement | undefined, style: ComputedStyle): ElementBox {
        // The base of a script or of a factorial, (x + 1)² and (n + 1)!, which the script would otherwise take for its last term.
        return arg === undefined ? this.anonymousBox(style, "mrow", []) : this.grouped(arg, style);
    }

    private optional(arg: SourceElement | undefined, style: ComputedStyle): ElementBox {
        return arg === undefined ? this.anonymousBox(style, "mrow", []) : this.render(arg, style);
    }

    private divided(arg: SourceElement | undefined, style: ComputedStyle, grouped: ReadonlySet<string>): ElementBox {
        // An operand of the slash of quotient, grouped as an operand of divide is.
        const box: ElementBox = this.optional(arg, style);
        return grouped.has(this.arithmetic.get(box) ?? "") ? this.parenthesized(style, box) : box;
    }

    private script(element: SourceElement, style: ComputedStyle, name: string, base: SourceElement | undefined, script: SourceElement | undefined): ElementBox {
        return this.own(element, style, name, [this.base(base, style), this.scriptBox(script, style, element)]);
    }

    private scriptBox(arg: SourceElement | undefined, style: ComputedStyle, element: SourceElement): ElementBox {
        // A script takes the style that the Appendix A rules give the scripts of msub, msup and munderover.
        const script: ComputedStyle = this.derivedStyle(style, element, SCRIPT);
        return this.anonymousBox(script, "mrow", arg === undefined ? [] : [this.render(arg, script)]);
    }

    private function(element: SourceElement, style: ComputedStyle, head: ElementBox, args: ReadonlyArray<SourceElement>, parenthesized: boolean): ElementBox {
        // §4.2.5.2: F, the function application operator, then (A1, ..., An); §4.3.7.6: the elementary functions take a single
        // token without parentheses.
        const single: boolean = !parenthesized && args.length === 1 && this.isToken(args[0]);
        const argument: ElementBox = single ? this.render(args[0], style) : this.parenthesized(style, this.anonymousBox(style, "mrow", this.separated(style, args, ",")));
        return this.own(element, style, "mrow", [head, this.operator(style, APPLY_FUNCTION), argument]);
    }

    private qualified(element: SourceElement, style: ComputedStyle, head: ElementBox, bvars: ReadonlyArray<SourceElement>, qualifiers: ReadonlyMap<string, SourceElement>,
        args: ReadonlyArray<SourceElement>): ElementBox {
        // §4.2.5.2, "in the absence of any more specific rendering rules": the operator over X ∈ D (or the condition), then
        // the function application operator and (expression in X).
        const under: ComputedStyle = this.derivedStyle(style, element, SCRIPT);
        return this.own(element, style, "mrow", [this.anonymousBox(style, "munder", [head, this.anonymousBox(under, "mrow", this.domain(under, bvars, qualifiers))]),
            this.operator(style, APPLY_FUNCTION), this.parenthesized(style, this.anonymousBox(style, "mrow", args.map((arg: SourceElement) => this.render(arg, style))))]);
    }

    private domain(style: ComputedStyle, bvars: ReadonlyArray<SourceElement>, qualifiers: ReadonlyMap<string, SourceElement>): Array<BoxNode> {
        // The restriction that qualifiers give the bound variables: a condition, a domain of application, or the limits.
        const condition: SourceElement | undefined = qualifiers.get("condition");
        if (condition !== undefined) {
            return [this.render(this.only(condition), style)];
        }
        const variables: Array<BoxNode> = this.joined(style, bvars.map((bvar: SourceElement) => this.variable(bvar, style)), ",");
        const domain: SourceElement | undefined = qualifiers.get("domainofapplication") ?? qualifiers.get("interval");
        if (domain !== undefined) {
            const set: ElementBox = this.render(domain.getLocalName() === "domainofapplication" ? this.only(domain) : domain, style);
            return variables.length === 0 ? [set] : [...variables, this.operator(style, "∈"), set];
        }
        const low: SourceElement | undefined = qualifiers.get("lowlimit");
        if (low !== undefined) {
            return [...variables, this.operator(style, "="), this.render(this.only(low), style)];
        }
        return variables;
    }

    private large(element: SourceElement, style: ComputedStyle, symbol: string, bvars: ReadonlyArray<SourceElement>, qualifiers: ReadonlyMap<string, SourceElement>,
        args: ReadonlyArray<SourceElement>): ElementBox {
        // §4.3.5.2, §4.3.5.3, §4.3.5.5 and §4.3.5.7: the large operator with x = a under it and b over it, or the condition or
        // the domain under it, then the body; the body of a logical one is in parentheses.
        const script: ComputedStyle = this.derivedStyle(style, element, SCRIPT);
        const upper: SourceElement | undefined = qualifiers.get("uplimit");
        const under: Array<BoxNode> = this.domain(script, bvars, qualifiers);
        const operator: ElementBox = this.operator(style, symbol);
        let limits: ElementBox = operator;
        if (upper !== undefined && !qualifiers.has("condition") && !qualifiers.has("domainofapplication")) {
            limits = this.anonymousBox(style, "munderover", [operator, this.anonymousBox(script, "mrow", under), this.anonymousBox(script, "mrow", [this.render(this.only(upper),
                script)])]);
        } else if (under.length > 0) {
            limits = this.anonymousBox(style, "munder", [operator, this.anonymousBox(script, "mrow", under)]);
        }
        const body: Array<ElementBox> = args.map((arg: SourceElement) => this.render(arg, style));
        return this.own(element, style, "mrow", [limits, ...(symbol === "⋀" ? [this.parenthesized(style, this.anonymousBox(style, "mrow", body))] : body)]);
    }

    private braces(style: ComputedStyle, bvars: ReadonlyArray<SourceElement>, qualifiers: ReadonlyMap<string, SourceElement>, args: ReadonlyArray<SourceElement>): ElementBox {
        // §4.3.5.12: min{a, b}, or min{body | condition} with a bound variable.
        if (qualifiers.has("condition") || bvars.length > 0) {
            const body: Array<BoxNode> = args.length > 0 ? args.map((arg: SourceElement) => this.render(arg, style))
                : bvars.map((bvar: SourceElement) => this.variable(bvar, style));
            return this.anonymousBox(style, "mrow", [this.operator(style, "{"), ...body, this.operator(style, "|"), ...this.domain(style, bvars, qualifiers),
                this.operator(style, "}")]);
        }
        return this.anonymousBox(style, "mrow", [this.operator(style, "{"), ...this.separated(style, args, ","), this.operator(style, "}")]);
    }

    private radical(element: SourceElement, style: ComputedStyle, qualifiers: ReadonlyMap<string, SourceElement>, args: ReadonlyArray<SourceElement>): ElementBox {
        // §4.3.6.1: mroot with the degree, msqrt without it ("a default value of 2").
        const degree: SourceElement | undefined = qualifiers.get("degree");
        const base: ElementBox = args[0] === undefined ? this.anonymousBox(style, "mrow", []) : this.render(args[0], style);
        if (degree === undefined) {
            return this.own(element, style, "msqrt", [base]);
        }
        const index: ComputedStyle = this.derivedStyle(style, element, INDEX);
        return this.own(element, style, "mroot", [base, this.anonymousBox(index, "mrow", [this.render(this.only(degree), index)])]);
    }

    private calculus(element: SourceElement, style: ComputedStyle, operator: string, bvars: ReadonlyArray<SourceElement>, args: ReadonlyArray<SourceElement>): ElementBox {
        // §4.3.7.7: div (a), grad (f), curl (a) and ∇² (E) as functions; with bound variables the argument maps them to the
        // expression, a vector of components one row per variable.
        const head: ElementBox = operator === "laplacian"
            ? this.anonymousBox(style, "msup", [this.operator(style, "∇"), this.token(this.derivedStyle(style, element, SCRIPT), "mn", "2")])
            : this.mi(style, element, NAMES.get(operator) ?? operator);
        if (bvars.length === 0) {
            return this.function(element, style, head, args, true);
        }
        const variables: Array<ElementBox> = bvars.map((bvar: SourceElement) => this.variable(bvar, style));
        const body: SourceElement | undefined = args[0];
        if (body !== undefined && body.getLocalName() === "vector") {
            const rows: Array<Array<Array<BoxNode>>> = this.mathChildren(body).map((component: SourceElement, index: number): Array<Array<BoxNode>> =>
                [[variables[index] ?? this.anonymousBox(style, "mrow", []), this.operator(style, "↦"), this.render(component, style)]]);
            return this.own(element, style, "mrow", [head, this.operator(style, APPLY_FUNCTION), this.operator(style, "("), this.table(style, element, rows, false),
                this.operator(style, ")")]);
        }
        const bound: ElementBox = variables.length === 1 ? variables[0] : this.parenthesized(style, this.anonymousBox(style, "mrow", this.joined(style, variables, ",")));
        return this.own(element, style, "mrow", [head, this.operator(style, APPLY_FUNCTION), this.parenthesized(style, this.anonymousBox(style, "mrow", [bound,
            this.operator(style, "↦"), ...(body === undefined ? [] : [this.render(body, style)])]))]);
    }

    private moment(element: SourceElement, style: ComputedStyle, qualifiers: ReadonlyMap<string, SourceElement>, args: ReadonlyArray<SourceElement>): ElementBox {
        // §4.3.7.8: ⟨data^degree⟩ with the point of momentabout under it.
        const script: ComputedStyle = this.derivedStyle(style, element, SCRIPT);
        const degree: SourceElement | undefined = qualifiers.get("degree");
        const about: SourceElement | undefined = qualifiers.get("momentabout");
        const data: ElementBox = args.length === 1 ? this.base(args[0], style) : this.parenthesized(style, this.anonymousBox(style, "mrow", this.separated(style, args, ",")));
        const powered: ElementBox = degree === undefined ? data
            : this.anonymousBox(style, "msup", [data, this.anonymousBox(script, "mrow", [this.render(this.only(degree), script)])]);
        const mean: ElementBox = this.anonymousBox(style, "mrow", [this.operator(style, "⟨"), powered, this.operator(style, "⟩")]);
        return about === undefined ? this.own(element, style, "mrow", [mean])
            : this.own(element, style, "msub", [mean, this.anonymousBox(script, "mrow", [this.render(this.only(about), script)])]);
    }

    private logarithm(element: SourceElement, style: ComputedStyle, qualifiers: ReadonlyMap<string, SourceElement>, args: ReadonlyArray<SourceElement>): ElementBox {
        // §4.3.7.9: log with the logbase under it, or log alone, as a function.
        const base: SourceElement | undefined = qualifiers.get("logbase");
        const script: ComputedStyle = this.derivedStyle(style, element, SCRIPT);
        const head: ElementBox = base === undefined ? this.mi(style, element, "log")
            : this.anonymousBox(style, "msub", [this.mi(style, element, "log"), this.anonymousBox(script, "mrow", [this.render(this.only(base), script)])]);
        return this.function(element, style, head, args, false);
    }

    private integral(element: SourceElement, style: ComputedStyle, bvars: ReadonlyArray<SourceElement>, qualifiers: ReadonlyMap<string, SourceElement>,
        args: ReadonlyArray<SourceElement>): ElementBox {
        // §4.3.8.1: ∫f, ∫ₐᵇf with an interval, ∫ₐᵇ body d x with a bound variable; other qualifiers go under the integral.
        const script: ComputedStyle = this.derivedStyle(style, element, SCRIPT);
        const sign: ElementBox = this.mi(style, element, "∫");
        const low: SourceElement | undefined = qualifiers.get("lowlimit");
        const up: SourceElement | undefined = qualifiers.get("uplimit");
        const interval: SourceElement | undefined = qualifiers.get("interval");
        const ends: Array<SourceElement> = interval !== undefined ? this.mathChildren(interval) : [];
        const lower: SourceElement | undefined = low !== undefined ? this.only(low) : ends[0];
        const upper: SourceElement | undefined = up !== undefined ? this.only(up) : ends[1];
        let operator: ElementBox = sign;
        if (lower !== undefined && upper !== undefined) {
            operator = this.anonymousBox(style, "msubsup", [sign, this.anonymousBox(script, "mrow", [this.render(lower, script)]), this.anonymousBox(script, "mrow",
                [this.render(upper, script)])]);
        } else if (qualifiers.has("condition") || qualifiers.has("domainofapplication")) {
            operator = this.anonymousBox(style, "msub", [sign, this.anonymousBox(script, "mrow", this.domain(script, bvars, qualifiers))]);
        }
        const body: Array<BoxNode> = args.map((arg: SourceElement) => this.render(arg, style));
        const differentials: Array<BoxNode> = bvars.flatMap((bvar: SourceElement): Array<BoxNode> => [this.mi(style, element, "d"), this.variable(bvar, style)]);
        return this.own(element, style, "mrow", [operator, ...body, ...differentials]);
    }

    private derivative(element: SourceElement, style: ComputedStyle, bvars: ReadonlyArray<SourceElement>, args: ReadonlyArray<SourceElement>): ElementBox {
        // §4.3.8.2: f′ for a function, d(body)/dx, and dⁿ(body)/dxⁿ with a degree in the bound variable.
        const body: SourceElement | undefined = args[0];
        const bvar: SourceElement | undefined = bvars[0];
        if (bvar === undefined) {
            return this.own(element, style, "msup", [this.base(body, style), this.operator(this.derivedStyle(style, element, SCRIPT), "′")]);
        }
        const degree: SourceElement | undefined = this.mathChildren(bvar).find((child: SourceElement) => child.getLocalName() === "degree");
        const numerator: ComputedStyle = this.derivedStyle(style, element, NUMERATOR);
        const denominator: ComputedStyle = this.derivedStyle(style, element, DENOMINATOR);
        const d: ElementBox = degree === undefined ? this.mi(numerator, element, "d")
            : this.anonymousBox(numerator, "msup", [this.mi(numerator, element, "d"), this.scriptBox(this.only(degree), numerator, element)]);
        const top: ElementBox = this.anonymousBox(numerator, "mrow", [d, ...(body === undefined ? [] : [this.render(body, numerator)])]);
        const variable: ElementBox = degree === undefined ? this.variable(bvar, denominator)
            : this.anonymousBox(denominator, "msup", [this.variable(bvar, denominator), this.scriptBox(this.only(degree), denominator, element)]);
        return this.own(element, style, "mfrac", [top, this.anonymousBox(denominator, "mrow", [this.mi(denominator, element, "d"), variable])]);
    }

    private partial(element: SourceElement, style: ComputedStyle, bvars: ReadonlyArray<SourceElement>, qualifiers: ReadonlyMap<string, SourceElement>,
        args: ReadonlyArray<SourceElement>): ElementBox {
        // §4.3.8.3: D with the indices for a list and a function, ∂ⁿ(body)/∂x^m ... otherwise, n the total degree, which is
        // the degree qualifier or the sum of the degrees of the variables, one for a variable without one.
        const numerator: ComputedStyle = this.derivedStyle(style, element, NUMERATOR);
        const denominator: ComputedStyle = this.derivedStyle(style, element, DENOMINATOR);
        const list: SourceElement | undefined = args.length === 2 && args[0].getLocalName() === "list" ? args[0] : undefined;
        const target: SourceElement | undefined = args[args.length - 1];
        if (list !== undefined && target !== undefined && target.getLocalName() !== "lambda") {
            const script: ComputedStyle = this.derivedStyle(style, element, SCRIPT);
            return this.own(element, style, "mrow", [this.anonymousBox(style, "msub", [this.mi(style, element, "D"), this.anonymousBox(script, "mrow", this.separated(script,
                this.mathChildren(list), ","))]), this.render(target, style)]);
        }
        const variables: Array<readonly [ElementBox, number | SourceElement]> = [];
        let body: ElementBox | undefined;
        if (list !== undefined && target !== undefined) {
            // The indices name the bound variables of the lambda, each as many times as it is listed.
            const [lambdaBvars, , lambdaArgs]: readonly [Array<SourceElement>, Map<string, SourceElement>, Array<SourceElement>] = this.split(this.mathChildren(target), false);
            const counts: Map<number, number> = new Map<number, number>();
            for (const index of this.mathChildren(list)) {
                const position: number = Number.parseInt(this.collapsed(this.textOf(index)), 10) - 1;
                counts.set(position, (counts.get(position) ?? 0) + 1);
            }
            for (const [position, count] of [...counts].sort((first: [number, number], second: [number, number]) => first[0] - second[0])) {
                const bvar: SourceElement | undefined = lambdaBvars[position];
                if (bvar !== undefined) {
                    variables.push([this.variable(bvar, denominator), count]);
                }
            }
            body = lambdaArgs.length > 0 ? this.render(lambdaArgs[0], numerator) : undefined;
        } else {
            for (const bvar of bvars) {
                const degree: SourceElement | undefined = this.mathChildren(bvar).find((child: SourceElement) => child.getLocalName() === "degree");
                const value: SourceElement | undefined = degree === undefined ? undefined : this.only(degree);
                const text: string = value === undefined ? "" : this.collapsed(this.textOf(value));
                variables.push([this.variable(bvar, denominator), value === undefined ? 1 : (value.getLocalName() === "cn" && INTEGER.test(text) ? Number(text) : value)]);
            }
            body = target === undefined ? undefined : this.render(target, numerator);
        }
        const total: SourceElement | undefined = qualifiers.get("degree");
        const numeric: number = variables.reduce((sum: number, entry: readonly [ElementBox, number | SourceElement]) => sum + (typeof entry[1] === "number" ? entry[1] : 0), 0);
        const symbolic: boolean = variables.some((entry: readonly [ElementBox, number | SourceElement]) => typeof entry[1] !== "number");
        const script: ComputedStyle = this.derivedStyle(numerator, element, SCRIPT);
        let order: ElementBox | undefined;
        if (total !== undefined) {
            order = this.anonymousBox(script, "mrow", [this.render(this.only(total), script)]);
        } else if (!symbolic && numeric > 1) {
            order = this.token(script, "mn", String(numeric));
        }
        const partial: ElementBox = order === undefined ? this.operator(numerator, "∂") : this.anonymousBox(numerator, "msup", [this.operator(numerator, "∂"), order]);
        const denominatorScript: ComputedStyle = this.derivedStyle(denominator, element, SCRIPT);
        const bottom: Array<BoxNode> = variables.map(([variable, degree]: readonly [ElementBox, number | SourceElement]): BoxNode => {
            const raised: BoxNode = degree === 1 ? variable : this.anonymousBox(denominator, "msup", [variable,
                typeof degree === "number" ? this.token(denominatorScript, "mn", String(degree)) : this.anonymousBox(denominatorScript, "mrow", [this.render(degree,
                    denominatorScript)])]);
            return this.anonymousBox(denominator, "mrow", [this.operator(denominator, "∂"), raised]);
        });
        return this.own(element, style, "mfrac", [this.anonymousBox(numerator, "mrow", [partial, ...(body === undefined ? [] : [body])]),
            this.anonymousBox(denominator, "mrow", bottom)]);
    }

    private limit(element: SourceElement, style: ComputedStyle, bvars: ReadonlyArray<SourceElement>, qualifiers: ReadonlyMap<string, SourceElement>,
        args: ReadonlyArray<SourceElement>): ElementBox {
        // §4.3.10.4: lim with x → a under it, or the condition under it, then the expression.
        const script: ComputedStyle = this.derivedStyle(style, element, SCRIPT);
        const low: SourceElement | undefined = qualifiers.get("lowlimit");
        const condition: SourceElement | undefined = qualifiers.get("condition");
        const variables: Array<BoxNode> = this.joined(script, bvars.map((bvar: SourceElement) => this.variable(bvar, script)), ",");
        const under: Array<BoxNode> = condition !== undefined ? [this.render(this.only(condition), script)]
            : [...variables, this.operator(script, "→"), ...(low === undefined ? [] : [this.render(this.only(low), script)])];
        return this.own(element, style, "mrow", [this.anonymousBox(style, "munder", [this.mi(style, element, "lim"), this.anonymousBox(script, "mrow", under)]),
            ...args.map((arg: SourceElement) => this.render(arg, style))]);
    }

    private container(element: SourceElement, style: ComputedStyle, local: string, children: ReadonlyArray<SourceElement>, closure: string): ElementBox {
        switch (local) {
            case "set":
            case "list":
                return this.collection(element, style, local, children);
            case "vector":
                return this.vector(element, style, children);
            case "matrix":
                return this.matrix(element, style, children);
            case "interval":
                return this.interval(element, style, closure, children);
            case "piecewise":
                return this.piecewise(element, style, children);
            default:
                return this.own(element, style, "mrow", local === "matrixrow" ? [] : children.map((child: SourceElement) => this.render(child, style)));
        }
    }

    private constructed(element: SourceElement): readonly [string, Array<SourceElement>] {
        // A matrix row or a piece is its element, or an apply of the csymbol of its symbol (Appendix E.3).
        const children: Array<SourceElement> = this.mathChildren(element);
        const head: SourceElement | undefined = children[0];
        const operator: string | undefined = element.getLocalName() === "apply" && head !== undefined ? this.operatorOf(head) : undefined;
        return operator !== undefined && CONTAINERS.has(operator) ? [operator, children.slice(1)] : [element.getLocalName(), children];
    }

    private collection(element: SourceElement, style: ComputedStyle, local: string, children: ReadonlyArray<SourceElement>): ElementBox {
        // §4.3.5.9: {a, b, c} and (a, b, c), or {body | condition} given by rule, the bound variable standing for an absent body.
        const [bvars, qualifiers, args]: readonly [Array<SourceElement>, Map<string, SourceElement>, Array<SourceElement>] = this.split(children, false);
        const [open, close]: readonly [string, string] = local === "set" ? ["{", "}"] : ["(", ")"];
        if (bvars.length === 0 && qualifiers.size === 0) {
            return this.own(element, style, "mrow", [this.operator(style, open), ...this.separated(style, args, ","), this.operator(style, close)]);
        }
        const body: Array<BoxNode> = args.length > 0 ? args.map((arg: SourceElement) => this.render(arg, style))
            : this.joined(style, bvars.map((bvar: SourceElement) => this.variable(bvar, style)), ",");
        return this.own(element, style, "mrow", [this.operator(style, open), ...body, this.operator(style, "|"), ...this.domain(style, bvars, qualifiers),
            this.operator(style, close)]);
    }

    private vector(element: SourceElement, style: ComputedStyle, children: ReadonlyArray<SourceElement>): ElementBox {
        // §4.3.5.8: a column in parentheses, one entry per row.
        const rows: Array<Array<Array<BoxNode>>> = children.map((entry: SourceElement): Array<Array<BoxNode>> => [[this.render(entry, style)]]);
        return this.own(element, style, "mrow", [this.operator(style, "("), this.table(style, element, rows, false), this.operator(style, ")")]);
    }

    private matrix(element: SourceElement, style: ComputedStyle, children: ReadonlyArray<SourceElement>): ElementBox {
        // §4.3.5.6 and §4.3.5.8: the rows of the matrix in parentheses; given by rule, [m_{i,j} | m_{i,j} = body ; condition].
        const [bvars, qualifiers, args]: readonly [Array<SourceElement>, Map<string, SourceElement>, Array<SourceElement>] = this.split(children, false);
        if (bvars.length === 0) {
            const rows: Array<Array<Array<BoxNode>>> = args.map((row: SourceElement): Array<Array<BoxNode>> =>
                this.constructed(row)[1].map((entry: SourceElement): Array<BoxNode> => [this.render(entry, style)]));
            return this.own(element, style, "mrow", [this.operator(style, "("), this.table(style, element, rows, false), this.operator(style, ")")]);
        }
        const script: ComputedStyle = this.derivedStyle(style, element, SCRIPT);
        const entry: () => ElementBox = (): ElementBox => this.anonymousBox(style, "msub", [this.mi(style, element, "m"), this.anonymousBox(script, "mrow", this.joined(script,
            bvars.map((bvar: SourceElement) => this.variable(bvar, script)), ","))]);
        return this.own(element, style, "mrow", [this.operator(style, "["), entry(), this.operator(style, "|"), this.anonymousBox(style, "mrow", [entry(),
            this.operator(style, "="), ...args.map((arg: SourceElement) => this.render(arg, style))]), this.operator(style, ";"), this.anonymousBox(style, "mrow",
            this.domain(style, bvars, qualifiers)), this.operator(style, "]")]);
    }

    private interval(element: SourceElement, style: ComputedStyle, closure: string, children: ReadonlyArray<SourceElement>): ElementBox {
        // §4.3.10.3: "(" and ")" at open ends, "[" and "]" at closed ones, closed by default.
        const open: string = closure === "open" || closure === "open-closed" ? "(" : "[";
        const close: string = closure === "open" || closure === "closed-open" ? ")" : "]";
        return this.own(element, style, "mrow", [this.operator(style, open), ...this.separated(style, children, ","), this.operator(style, close)]);
    }

    private piecewise(element: SourceElement, style: ComputedStyle, children: ReadonlyArray<SourceElement>): ElementBox {
        // §4.3.10.5: a brace before a table of "value if condition" rows; otherwise, which has no sample, as the prose writes it,
        // "H(x) = 1 otherwise".
        const rows: Array<Array<Array<BoxNode>>> = children.map((piece: SourceElement): Array<Array<BoxNode>> => {
            const [kind, parts]: readonly [string, Array<SourceElement>] = this.constructed(piece);
            const value: Array<BoxNode> = parts[0] === undefined ? [] : [this.render(parts[0], style)];
            if (kind === "otherwise") {
                return [value, [this.token(style, "mtext", NO_BREAK + " otherwise")]];
            }
            return [value, [this.token(style, "mtext", NO_BREAK + " if " + NO_BREAK)], parts[1] === undefined ? [] : [this.render(parts[1], style)]];
        });
        return this.own(element, style, "mrow", [this.operator(style, "{"), this.table(style, element, rows, true)]);
    }

    private table(style: ComputedStyle, element: SourceElement, rows: ReadonlyArray<ReadonlyArray<ReadonlyArray<BoxNode>>>, leftSecond: boolean): ElementBox {
        // The table, rows and cells take the styles that the Appendix A rules give mtable, mtr and mtd; each cell holds an
        // anonymous mrow (MathML Core §3.5.3).
        const tableStyle: ComputedStyle = this.derivedStyle(style, element, TABLE);
        const rowStyle: ComputedStyle = this.derivedStyle(tableStyle, element, ROW);
        const cellStyle: ComputedStyle = this.derivedStyle(rowStyle, element, CELL);
        const leftStyle: ComputedStyle = this.derivedStyle(rowStyle, element, LEFT_CELL);
        const rowBoxes: Array<BoxNode> = rows.map((row: ReadonlyArray<ReadonlyArray<BoxNode>>): BoxNode =>
            this.internal(rowStyle, "mtr", row.map((cell: ReadonlyArray<BoxNode>, index: number): BoxNode => {
                const own: ComputedStyle = leftSecond && index === 1 ? leftStyle : cellStyle;
                return this.internal(own, "mtd", [this.anonymousBox(own, "mrow", [...cell])]);
            })));
        return this.internal(tableStyle, "mtable", rowBoxes);
    }

    private internal(style: ComputedStyle, name: string, children: Array<BoxNode>): ElementBox {
        const box: ElementBox = {
            kind: "box", style, display: this.displays.parse(style.values["display"]), placement: "in-flow", replaced: false, hasStartEdge: true, hasEndEdge: true,
            usedPage: "", startPage: "", endPage: "", children
        };
        this.elements.set(box, { name });
        return box;
    }

    private split(children: ReadonlyArray<SourceElement>, applied: boolean): readonly [Array<SourceElement>, Map<string, SourceElement>, Array<SourceElement>] {
        // §4.3.3: qualifiers follow the operator in the order bvar, lowlimit, uplimit, interval, condition, domainofapplication,
        // degree, momentabout, logbase; an interval right after them, with arguments after it, is a qualifier (§4.3.3.1).
        const bvars: Array<SourceElement> = [];
        const qualifiers: Map<string, SourceElement> = new Map<string, SourceElement>();
        const args: Array<SourceElement> = [];
        children.forEach((child: SourceElement, index: number) => {
            const local: string = child.getLocalName();
            if (local === "bvar") {
                bvars.push(child);
            } else if (QUALIFIERS.has(local)) {
                qualifiers.set(local, child);
            } else if (local === "interval" && applied && args.length === 0 && index < children.length - 1) {
                qualifiers.set("interval", child);
            } else {
                args.push(child);
            }
        });
        return [bvars, qualifiers, args];
    }

    private operatorOf(head: SourceElement): string | undefined {
        // An empty operator element, or a csymbol naming the OpenMath symbol of one (Appendix E.3), by its cd or by the content
        // dictionary that ends the path of its definitionURL (§4.2.3.2, "cdbase + '/' + cd-name + '#' + symbol-name").
        const local: string = head.getLocalName();
        if (local === "lambda" && head.getChildren().length === 0) {
            return "lambda";
        }
        if (OPERATORS.has(local)) {
            return local;
        }
        if (local !== "csymbol") {
            return undefined;
        }
        const name: string = this.collapsed(this.textOf(head));
        let cd: string | undefined = head.getAttributeValue("cd")?.trim();
        if (cd === undefined) {
            const url: string | undefined = head.getAttributeValue("definitionURL");
            const hash: number = url === undefined ? -1 : url.lastIndexOf("#");
            cd = url === undefined || hash < 0 ? undefined : url.substring(url.lastIndexOf("/", hash) + 1, hash);
        }
        if (cd === "fns1" && name === "lambda") {
            return "lambda";
        }
        return cd === undefined ? undefined : this.dictionary.contentElement(cd, name);
    }

    private render(element: SourceElement, style: ComputedStyle): ElementBox {
        return this.childBox(element, style) ?? this.anonymousBox(style, "mrow", []);
    }

    private variable(bvar: SourceElement, style: ComputedStyle): ElementBox {
        // §4.2.6.2: the annotated variable of a bvar, its degree aside, styled as a child of the bvar.
        const variable: SourceElement | undefined = this.mathChildren(bvar).find((child: SourceElement) => child.getLocalName() !== "degree");
        return variable === undefined ? this.anonymousBox(style, "mrow", []) : this.render(variable, this.styleOf(bvar, style, this.viewport, this.root as ComputedStyle));
    }

    private separated(style: ComputedStyle, args: ReadonlyArray<SourceElement>, separator: string): Array<BoxNode> {
        return this.joined(style, args.map((arg: SourceElement) => this.render(arg, style)), separator);
    }

    private joined(style: ComputedStyle, items: ReadonlyArray<BoxNode>, separator: string): Array<BoxNode> {
        const result: Array<BoxNode> = [];
        items.forEach((item: BoxNode, index: number) => {
            if (index > 0) {
                result.push(this.operator(style, separator));
            }
            result.push(item);
        });
        return result;
    }

    private parenthesized(style: ComputedStyle, box: ElementBox): ElementBox {
        return this.anonymousBox(style, "mrow", [this.operator(style, "("), box, this.operator(style, ")")]);
    }

    private own(element: SourceElement, style: ComputedStyle, name: string, children: Array<BoxNode>): ElementBox {
        // The box of the content element, laid out as the presentation element that renders it.
        const box: ElementBox = {
            kind: "box", element, style, display: this.displays.parse(style.values["display"]), placement: "in-flow", replaced: false, hasStartEdge: true,
            hasEndEdge: true, usedPage: "", startPage: "", endPage: "", children
        };
        this.linked(box, element, style);
        this.elements.set(box, { name });
        return box;
    }

    private mi(style: ComputedStyle, element: SourceElement, text: string): ElementBox {
        // An identifier of the rendering takes the text-transform of the mi rule of Appendix A.
        const own: ComputedStyle = this.derivedStyle(style, element, IDENTIFIER);
        return this.anonymousBox(own, "mi", [this.text(own, text)]);
    }

    private token(style: ComputedStyle, name: string, text: string): ElementBox {
        return this.anonymousBox(style, name, [this.text(style, text)]);
    }

    private derivedStyle(parent: ComputedStyle, element: SourceElement, declarations: string): ComputedStyle {
        // The style of an anonymous box that renders an element of the formula, computed from declarations of its own, as the
        // style of an element with those declarations would be.
        let known: Map<string, ComputedStyle> | undefined = this.styles.get(parent);
        if (known === undefined) {
            known = new Map<string, ComputedStyle>();
            this.styles.set(parent, known);
        }
        let style: ComputedStyle | undefined = known.get(declarations);
        if (style === undefined) {
            style = this.computer.compute(StyleComputer.input(this.markup.declared(declarations), this.viewport, StyleComputer.NO_CONTAINERS, parent,
                this.root as ComputedStyle, element));
            known.set(declarations, style);
        }
        return style;
    }

    private children(element: SourceElement, style: ComputedStyle): Array<BoxNode> {
        const result: Array<BoxNode> = [];
        for (const child of this.mathChildren(element)) {
            const built: ElementBox | undefined = this.childBox(child, style);
            if (built !== undefined) {
                result.push(built);
            }
        }
        return result;
    }

    private mathChildren(element: SourceElement): Array<SourceElement> {
        return element.getChildren().filter((child: SourceElement) => this.markup.isMath(child));
    }

    private only(qualifier: SourceElement): SourceElement {
        return this.mathChildren(qualifier)[0] ?? qualifier;
    }

    private isToken(element: SourceElement): boolean {
        const local: string = element.getLocalName();
        return TOKEN_ELEMENTS.has(local) || CONSTANTS.has(local) || SETS.has(local) || (OPERATORS.has(local) && element.getChildren().length === 0 && !INFIX.has(local));
    }

    private numberParts(element: SourceElement): Array<string> {
        // The text of a cn, split at its sep elements, each part with its white space collapsed.
        const parts: Array<string> = [""];
        for (const node of element.getContent()) {
            if (node instanceof TextNode) {
                parts[parts.length - 1] += node.getValue();
            } else if (node instanceof SourceElement && node.getLocalName() === "sep") {
                parts.push("");
            }
        }
        return parts.map((part: string) => this.collapsed(part));
    }

    private textOf(element: SourceElement): string {
        let text: string = "";
        for (const node of element.getContent()) {
            if (node instanceof TextNode) {
                text += node.getValue();
            }
        }
        return text;
    }

    private collapsed(text: string): string {
        return text.replace(MATH_WHITE_SPACE, " ").trim();
    }

    private top(element: SourceElement): SourceElement {
        let current: SourceElement = element;
        while (current.getParent() !== undefined) {
            current = current.getParent() as SourceElement;
        }
        return current;
    }

    private byId(element: SourceElement, id: string): SourceElement | undefined {
        if (element.getAttributeValue("id") === id || element.getAttributeValue("xml:id") === id) {
            return element;
        }
        for (const child of element.getChildren()) {
            const found: SourceElement | undefined = this.byId(child, id);
            if (found !== undefined) {
                return found;
            }
        }
        return undefined;
    }

    private operator(style: ComputedStyle, text: string): ElementBox {
        return this.anonymousBox(style, "mo", [this.text(style, text)]);
    }

    private anonymousBox(style: ComputedStyle, name: string, children: Array<BoxNode>): ElementBox {
        // MathML Core §3.1.3: an anonymous box inherits from the enclosing box and has display block math.
        const box: ElementBox = {
            kind: "box", style: this.anonymous(style), display: MATH_BOX, placement: "in-flow", replaced: false, hasStartEdge: true, hasEndEdge: true, usedPage: "",
            startPage: "", endPage: "", children
        };
        this.elements.set(box, { name });
        return box;
    }

    private text(style: ComputedStyle, text: string, language?: string): TextSequence {
        const node: TextSequence = { kind: "text", text, style: this.anonymous(style) };
        if (language !== undefined) {
            node.language = language;
        }
        return node;
    }

    private anonymous(style: ComputedStyle): ComputedStyle {
        // CSS 2.1 §9.2.1.1: anonymous boxes and text inherit from their parent box, their other properties initial.
        const anonymous: ComputedStyle = { values: style.inherited, inherited: style.inherited, custom: style.custom };
        if (style.zoom !== undefined) {
            anonymous.zoom = style.zoom;
        }
        return anonymous;
    }
}
