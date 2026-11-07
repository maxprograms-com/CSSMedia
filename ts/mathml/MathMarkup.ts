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

import type { CssNode, Declaration as CssTreeDeclaration } from "css-tree";
import { parse } from "css-tree";
import { AsciiCase } from "../css/AsciiCase.js";
import { DeclarationReader } from "../css/DeclarationReader.js";
import { PropertyTable } from "../css/PropertyTable.js";
import { SelectorCompiler } from "../css/SelectorCompiler.js";
import type { Declaration, DeclaredValue, StyleRule } from "../css/Stylesheet.js";
import type { CssValue } from "../css/values/CssValue.js";
import type { SourceElement } from "../parse/SourceElement.js";
import { BaseUrls } from "../pdf/BaseUrls.js";
import type { DisplayType } from "../pdf/DisplayTypes.js";
import { DisplayTypes } from "../pdf/DisplayTypes.js";
import type { ElementUnits } from "../pdf/ElementUnits.js";
import type { FontMetrics } from "../pdf/FontMetrics.js";
import { MATH_VARIANTS } from "./generated/MathVariants.js";
import { LengthResolver } from "../pdf/LengthResolver.js";
import { SelectorMatcher } from "../pdf/SelectorMatcher.js";
import type { StyleInput } from "../pdf/StyleComputer.js";
import { StyleComputer } from "../pdf/StyleComputer.js";
import type { UserAgentRules } from "../pdf/UserAgentRules.js";

export interface MathElement {
    name: string;
    form?: string;
    stretchy?: boolean;
    symmetric?: boolean;
    largeop?: boolean;
    movablelimits?: boolean;
    accent?: boolean;
    accentunder?: boolean;
    lspace?: CssValue;
    rspace?: CssValue;
    minsize?: CssValue;
    maxsize?: CssValue;
    linethickness?: CssValue;
    height?: number;
    depth?: number;
    voffset?: number;
    paddedSpace?: number;
    notations?: ReadonlyArray<string>;
    tableAlign?: string;
    alignRow?: number;
    equalRows?: boolean;
    equalColumns?: boolean;
    columnWidths?: ReadonlyArray<string>;
    axisAligned?: boolean;
    stackAlign?: string;
    charAlign?: string;
    charSpacing?: number;
    decimalCharacter?: string;
    longdivStyle?: string;
    position?: number;
    shift?: number;
    location?: string;
    crossout?: ReadonlyArray<string>;
    lineLength?: number;
    leftOverhang?: number;
    rightOverhang?: number;
    lineThickness?: string;
    lineWidth?: number;
    digitGroup?: number;
    lineBreak?: string;
    lineBreakStyle?: string;
    lineBreakMultchar?: string;
    indentAlign?: string;
    indentShift?: CssValue;
    indentTarget?: string;
    indentAlignFirst?: string;
    indentShiftFirst?: CssValue;
    indentAlignLast?: string;
    indentShiftLast?: CssValue;
    lineLeading?: CssValue;
    maxWidth?: number;
    overflow?: string;
    numAlign?: string;
    denomAlign?: string;
    bevelled?: boolean;
    scriptAlign?: string;
    subscriptShift?: number;
    superscriptShift?: number;
}

const NO_DECLARATIONS: ReadonlyArray<Declaration> = [];
const MATHML_RULES: ReadonlyArray<readonly [string, string]> = [
    ["*", "font-size: math; display: block math; writing-mode: horizontal-tb !important"],
    ["math", "direction: ltr; text-indent: 0; letter-spacing: normal; line-height: normal; word-spacing: normal; font-family: math; font-size: inherit; "
        + "font-style: normal; font-weight: normal; display: inline math; math-shift: normal; math-style: compact; math-depth: 0"],
    ["math[display=\"block\" i]", "display: block math; math-style: normal"],
    ["math[display=\"inline\" i]", "display: inline math; math-style: compact"],
    ["semantics > :not(:first-child)", "display: none"],
    ["merror", "border: 1px solid red; background-color: lightYellow"],
    ["mphantom", "visibility: hidden"],
    ["mi", "text-transform: math-auto"],
    ["ci, csymbol", "text-transform: math-auto"],
    ["cerror", "border: 1px solid red; background-color: lightYellow"],
    ["mtable", "display: inline-table; math-style: compact"],
    ["mtr", "display: table-row"],
    ["mtd", "display: table-cell; text-align: center; padding: 0.5ex 0.4em"],
    ["mfrac", "padding-inline: 1px"],
    ["mfrac > *", "math-depth: auto-add; math-style: compact"],
    ["mfrac > :nth-child(2)", "math-shift: compact"],
    ["mroot > :not(:first-child)", "math-depth: add(2); math-style: compact"],
    ["mroot, msqrt", "math-shift: compact"],
    ["msub > :not(:first-child), msup > :not(:first-child), msubsup > :not(:first-child), mmultiscripts > :not(:first-child), munder > :not(:first-child), "
        + "mover > :not(:first-child), munderover > :not(:first-child)", "math-depth: add(1); math-style: compact"],
    ["munder[accentunder=\"true\" i] > :nth-child(2), mover[accent=\"true\" i] > :nth-child(2), munderover[accentunder=\"true\" i] > :nth-child(2), "
        + "munderover[accent=\"true\" i] > :nth-child(3)", "font-size: inherit"],
    ["msub > :nth-child(2), msubsup > :nth-child(2), mmultiscripts > :nth-child(even), mmultiscripts > mprescripts ~ :nth-child(odd), "
        + "mover[accent=\"true\" i] > :first-child, munderover[accent=\"true\" i] > :first-child", "math-shift: compact"],
    ["mmultiscripts > mprescripts ~ :nth-child(even)", "math-shift: inherit"],
    ["a[href]", PropertyTable.LINK + ": attr(href url)"],
    ["mglyph", "display: inline; content: attr(src url) / attr(alt)"],
    ["mscarries", "math-depth: add(1); math-style: compact"],
    ["[href]", PropertyTable.LINK + ": attr(href url)"]
];
const DIRECTIONS: ReadonlySet<string> = new Set<string>(["ltr", "rtl"]);
const UNSIGNED_INTEGER: RegExp = /^[0-9]+$/;
const SIGNED_INTEGER: RegExp = /^([+-])([0-9]+)$/;
const LENGTH_PERCENTAGE: string = "length-percentage";
const COLOR: string = "color";
const PERCENTAGE: RegExp = /^\s*[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?%\s*$/;
const CORE_ELEMENTS: ReadonlySet<string> = new Set<string>(["a", "annotation", "annotation-xml", "maction", "math", "merror", "mfrac", "mi", "mmultiscripts", "mn", "mo",
    "mover", "mpadded", "mphantom", "mprescripts", "mroot", "mrow", "ms", "mspace", "msqrt", "mstyle", "msub", "msubsup", "msup", "mtable", "mtd", "mtext", "mtr", "munder",
    "munderover", "semantics"]);
const FULL_ELEMENTS: ReadonlySet<string> = new Set<string>(["menclose", "mstack", "mlongdiv", "msgroup", "msrow", "mscarries", "mscarry", "msline"]);
const INTEGER: RegExp = /^[ \t\n\r]*([+-]?[0-9]+)[ \t\n\r]*$/;
const STACK_ALIGNS: ReadonlySet<string> = new Set<string>(["left", "center", "right", "decimalpoint"]);
const CHAR_ALIGNS: ReadonlySet<string> = new Set<string>(["left", "center", "right"]);
const LOCATIONS: ReadonlySet<string> = new Set<string>(["w", "nw", "n", "ne", "e", "se", "s", "sw"]);
const CROSSOUTS: ReadonlySet<string> = new Set<string>(["none", "updiagonalstrike", "downdiagonalstrike", "verticalstrike", "horizontalstrike"]);
const LINE_THICKNESSES: ReadonlySet<string> = new Set<string>(["thin", "medium", "thick"]);
const LINE_BREAKS: ReadonlySet<string> = new Set<string>(["auto", "newline", "nobreak", "goodbreak", "badbreak"]);
const LINE_BREAK_STYLES: ReadonlySet<string> = new Set<string>(["before", "after", "duplicate", "infixlinebreakstyle"]);
const INFIX_STYLES: ReadonlySet<string> = new Set<string>(["before", "after", "duplicate"]);
const INDENT_ALIGNS: ReadonlySet<string> = new Set<string>(["left", "center", "right", "auto", "id", "indentalign"]);
const INVISIBLE_TIMES: string = String.fromCodePoint(0x2062);
const NEGATIVE_SPACE: string = "negative";
const NAMED_SPACES: ReadonlyArray<string> = ["veryverythinmathspace", "verythinmathspace", "thinmathspace", "mediummathspace", "thickmathspace",
    "verythickmathspace", "veryverythickmathspace"];
const MATH_SIZES: ReadonlyMap<string, string> = new Map<string, string>([["small", "smaller"], ["normal", "100%"], ["big", "larger"]]);
const OVERFLOWS: ReadonlySet<string> = new Set<string>(["linebreak", "scroll", "elide", "truncate", "scale"]);
const UNDER_OVER: ReadonlySet<string> = new Set<string>(["munder", "mover", "munderover"]);
const NO_TARGETS: ReadonlySet<string> = new Set<string>();
const MSTYLE_TARGETS: ReadonlyMap<string, ReadonlySet<string>> = new Map<string, ReadonlySet<string>>([
    ["height", new Set<string>(["mspace"])], ["depth", new Set<string>(["mspace"])], ["width", new Set<string>(["mspace"])], ["rowalign", new Set<string>(["mtable"])],
    ["columnalign", new Set<string>(["mtable"])], ["lspace", new Set<string>(["mo"])], ["align", UNDER_OVER], ["voffset", NO_TARGETS], ["src", NO_TARGETS]
]);
const SCRIPTED_ELEMENTS: ReadonlySet<string> = new Set<string>(["msub", "msup", "msubsup", "munder", "mover", "munderover", "mmultiscripts", "mfrac"]);
const GROUPING_ELEMENTS: ReadonlySet<string> = new Set<string>(["mrow", "mstyle", "mphantom", "mpadded", "a", "merror", "maction", "semantics"]);
const SPACE_LIKE_ELEMENTS: ReadonlySet<string> = new Set<string>(["mtext", "mspace"]);
const SCRIPT_ALIGNS: ReadonlySet<string> = new Set<string>(["left", "center", "right"]);
const QUOTE: string = "\"";
const ESCAPE: string = "\\";
const FORMS: ReadonlySet<string> = new Set<string>(["infix", "prefix", "postfix"]);
const OPERATOR_FLAGS: ReadonlyArray<"stretchy" | "symmetric" | "largeop" | "movablelimits"> = ["stretchy", "symmetric", "largeop", "movablelimits"];
const OPERATOR_LENGTHS: ReadonlyArray<"lspace" | "rspace" | "minsize" | "maxsize"> = ["lspace", "rspace", "minsize", "maxsize"];
const NON_NEGATIVE: RegExp = /^[\t\n\f\r ]*\+?([0-9]+)/;
const MAXIMUM_COLUMN_SPAN: number = 1000;
const MAXIMUM_ROW_SPAN: number = 65534;
const MATH_WHITE_SPACE: RegExp = /[ \t\n\r]+/g;
const COLUMN_ALIGNS: ReadonlySet<string> = new Set<string>(["left", "center", "right"]);
const ROW_ALIGNS: ReadonlyMap<string, string> = new Map<string, string>([["top", "top"], ["bottom", "bottom"], ["center", "middle"], ["baseline", "baseline"]]);
const LINE_STYLES: ReadonlySet<string> = new Set<string>(["solid", "dashed"]);
const TABLE_ALIGNS: ReadonlySet<string> = new Set<string>(["top", "bottom", "center", "baseline", "axis"]);
const SIGNED_ROW: RegExp = /^[+-]?[0-9]+$/;
const COLUMN_EDGE: string = "0.4em";
const ROW_EDGE: string = "0.5ex";
const MATH_WHITE_SPACE_CHARACTER: RegExp = /^[ \t\n\r]$/;
const MATH_NUMBER: RegExp = /^-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/;
const CARRIES_MULTIPLIER: number = 0.6;
const SCRIPT_MIN_SIZE: string = "8pt";

export class MathMarkup {

    static readonly NAMESPACE: string = "http://www.w3.org/1998/Math/MathML";
    static readonly COMPUTED: ReadonlySet<string> = new Set<string>(["font-size", "display"]);
    static readonly TOKENS: ReadonlySet<string> = new Set<string>(["mi", "mn", "mo", "ms", "mtext"]);
    static readonly STACKS: ReadonlySet<string> = new Set<string>(["mstack", "mlongdiv", "msgroup"]);
    static readonly STACK_ITEMS: ReadonlySet<string> = new Set<string>(["msrow", "msgroup", "mscarries", "msline"]);

    private readonly prefixes: ReadonlyMap<string, string>;
    private readonly rootNamespace?: string;
    private readonly metrics: FontMetrics;
    private readonly displays: DisplayTypes = new DisplayTypes();
    private readonly lengths: LengthResolver = new LengthResolver();
    private readonly table: PropertyTable;
    private readonly reader: DeclarationReader;
    private readonly urls: BaseUrls;
    private readonly asciiCase: AsciiCase = new AsciiCase();
    private readonly hinted: WeakMap<SourceElement, ReadonlyArray<Declaration>> = new WeakMap<SourceElement, ReadonlyArray<Declaration>>();
    private readonly attached: WeakMap<SourceElement, ReadonlyArray<Declaration>> = new WeakMap<SourceElement, ReadonlyArray<Declaration>>();
    private readonly slots: WeakMap<SourceElement, ReadonlyMap<SourceElement, readonly [number, number, number, number]>> =
        new WeakMap<SourceElement, ReadonlyMap<SourceElement, readonly [number, number, number, number]>>();
    private readonly extents: WeakMap<SourceElement, readonly [number, number]> = new WeakMap<SourceElement, readonly [number, number]>();
    private readonly variants: ReadonlyMap<string, ReadonlyMap<number, number>> = new Map<string, ReadonlyMap<number, number>>(
        MATH_VARIANTS.map(([name, pairs]: readonly [string, ReadonlyArray<readonly [number, number]>]): [string, ReadonlyMap<number, number>] => [name, new Map<number, number>(pairs)]));

    constructor(table: PropertyTable, prefixes: ReadonlyMap<string, string>, documentUri: string, metrics: FontMetrics, rootNamespace?: string) {
        this.table = table;
        this.prefixes = prefixes;
        if (rootNamespace !== undefined) {
            this.rootNamespace = rootNamespace;
        }
        this.metrics = metrics;
        this.reader = new DeclarationReader(table);
        this.urls = new BaseUrls(documentUri);
    }

    isMath(element: SourceElement): boolean {
        const prefix: string = element.getNamespace();
        return (prefix.length > 0 ? this.prefixes.get(prefix) : element.getAttributeValue("xmlns") ?? this.rootNamespace) === MathMarkup.NAMESPACE;
    }

    variantText(element: SourceElement, text: string): string {
        // MathML 4 §3.2.2: a token with the unstyled character and a mathvariant value "is equivalent to a token element that
        // uses the mathematical alphanumeric symbol character"; a character without one in that variant stays as it is.
        const variant: string | undefined = this.lower(this.scopedAttribute(element, "mathvariant"));
        return variant === undefined ? text : this.variant(text, variant);
    }

    variant(text: string, variant: string): string {
        const mapping: ReadonlyMap<number, number> | undefined = this.variants.get(variant);
        if (mapping === undefined) {
            return text;
        }
        return [...text].map((character: string): string => {
            const styled: number | undefined = mapping.get(character.codePointAt(0) as number);
            return styled === undefined ? character : String.fromCodePoint(styled);
        }).join("");
    }

    quotes(element: SourceElement): readonly [string, string] {
        // MathML 4 §3.2.9: lquote and rquote, a double quote by default.
        return [this.scopedAttribute(element, "lquote") ?? QUOTE, this.scopedAttribute(element, "rquote") ?? QUOTE];
    }

    escaped(text: string, quotes: readonly [string, string]): string {
        // §3.2.9: "visible escaping" of the quotes inside the content, as in "double quote is \"".
        let result: string = text;
        for (const mark of new Set<string>(quotes)) {
            result = mark.length === 0 ? result : result.split(mark).join(ESCAPE + mark);
        }
        return result;
    }

    fences(element: SourceElement): readonly [string, string, ReadonlyArray<string>] {
        // §3.3.8.2: open and close, and the separators, the last repeated when there are too few and none when the attribute has
        // no character; the white space of separators is ignored.
        const open: string = this.collapsed(element.getAttributeValue("open") ?? "(");
        const close: string = this.collapsed(element.getAttributeValue("close") ?? ")");
        const separators: Array<string> = [...(element.getAttributeValue("separators") ?? ",")].filter((character: string) => !MATH_WHITE_SPACE_CHARACTER.test(character));
        return [open, close, separators];
    }

    computedValue(property: string, value: CssValue, input: StyleInput, standard: (property: string) => CssValue | undefined, units: ElementUnits,
        parentSize: () => number): CssValue | undefined {
        switch (property) {
            case "font-size":
                return value.kind === "ident" && value.lower === "math" ? { kind: "length", px: this.scriptSize(input, standard, units, parentSize()) }
                    : this.mathSize(value, input, standard, units, parentSize);
            case "display": {
                // §4.1: "For elements that are not MathML elements, if the specified value of display is block math or inline
                // math then the computed value is block flow and inline flow respectively", and for mtable, mtr and mtd a table's.
                const display: DisplayType = this.displays.parse(value);
                if (display.inner !== "math") {
                    return undefined;
                }
                const element: SourceElement | undefined = input.pseudoElement === undefined ? input.element : undefined;
                if (element === undefined || !this.isMath(element)) {
                    return this.displays.value({ ...display, inner: "flow" });
                }
                switch (element.getLocalName()) {
                    case "mtable":
                        return this.displays.value({ ...display, inner: "table" });
                    case "mtr":
                        return this.displays.value({ ...display, internal: "table-row" });
                    case "mtd":
                        return this.displays.value({ ...display, internal: "table-cell" });
                    default:
                        return undefined;
                }
            }
            default:
                return undefined;
        }
    }

    private scriptSize(input: StyleInput, standard: (property: string) => CssValue | undefined, units: ElementUnits, parent: number): number {
        // MathML 4 §3.1.6: "the current font size is multiplied by the value of scriptsizemultiplier to the power of the change
        // in scriptlevel", and those changes "should never reduce the size below scriptminsize"; without one, MathML Core's scale.
        const element: SourceElement | undefined = input.pseudoElement === undefined ? input.element : undefined;
        const multiplier: number | undefined = element === undefined ? undefined : this.scriptSizeMultiplier(element);
        const inherited: number = this.depthOf(input.parent?.values["math-depth"]);
        const computed: number = this.depthOf(standard("math-depth"));
        let size: number = multiplier === undefined ? parent * this.metrics.mathScale(input.parent?.values ?? {}, inherited, computed) : parent * Math.pow(multiplier, computed - inherited);
        if (element !== undefined && size < parent) {
            const minimum: Declaration | undefined = this.declarationList("font-size: " + this.scriptMinSize(element), "about:blank")[0];
            const pixels: number | undefined = minimum?.value.kind === "value" ? this.lengths.pixelsOf(minimum.value.value, units, parent) : undefined;
            size = pixels === undefined ? size : Math.max(size, Math.min(parent, pixels));
        }
        return Math.max(0, size);
    }

    private mathSize(value: CssValue, input: StyleInput, standard: (property: string) => CssValue | undefined, units: ElementUnits,
        parentSize: () => number): CssValue | undefined {
        // MathML 4 §3.1.6: "the effect of scriptlevel is applied before an explicit mathsize", so a relative mathsize, normal
        // being "equivalent to 100% or 1em", refers to the size that the change of scriptlevel gives.
        const element: SourceElement | undefined = input.pseudoElement === undefined ? input.element : undefined;
        const hint: Declaration | undefined = element === undefined || !this.isMath(element) ? undefined
            : this.hints(element).find((declaration: Declaration) => declaration.property === "font-size");
        if (hint === undefined || hint.value.kind !== "value" || hint.value.value !== value) {
            return undefined;
        }
        const parent: number = parentSize();
        const scaled: number = this.scriptSize(input, standard, units, parent);
        if (scaled === parent) {
            return undefined;
        }
        let size: number | undefined;
        if (value.kind === "percentage") {
            size = scaled * value.value / 100;
        } else if (value.kind === "dimension" && value.unit.toLowerCase() === "em") {
            size = scaled * value.value;
        } else if (value.kind === "ident" && value.lower === "larger") {
            size = scaled * StyleComputer.RELATIVE_SIZE_RATIO;
        } else if (value.kind === "ident" && value.lower === "smaller") {
            size = scaled / StyleComputer.RELATIVE_SIZE_RATIO;
        }
        return size === undefined ? undefined : { kind: "length", px: Math.max(0, size) };
    }

    private depthOf(value?: CssValue): number {
        return value !== undefined && value.kind === "number" ? value.value : 0;
    }

    styleRules(rules: UserAgentRules, start: number): Array<StyleRule> {
        // MathML Core §2.2.2: the CSS rules of Appendix A, with the MathML namespace as the default one; MathML 4 adds mglyph
        // and href (§3.2.1.1, §2.1.6); ci and csymbol render as mi (§4.2.2.3, §4.2.3.3) and cerror as merror (§4.2.9).
        const namespaces: ReadonlyMap<string, string> = new Map<string, string>([[SelectorCompiler.DEFAULT_NAMESPACE, MathMarkup.NAMESPACE]]);
        return MATHML_RULES.map(([selectors, declarations]: readonly [string, string], index: number): StyleRule => rules.rule(selectors, declarations, start + index, namespaces));
    }

    private coreOperator(element: SourceElement): SourceElement | undefined {
        // MathML Core §3.2.4.1 read on the MathML children, of which semantics shows its first and maction its selected one.
        if (!this.isMath(element)) {
            return undefined;
        }
        const local: string = element.getLocalName();
        if (local === "mo") {
            return element;
        }
        const children: Array<SourceElement> = this.shown(element);
        if (SCRIPTED_ELEMENTS.has(local)) {
            return children.length === 0 ? undefined : this.coreOperator(children[0]);
        }
        if (!GROUPING_ELEMENTS.has(local) && (CORE_ELEMENTS.has(local) || FULL_ELEMENTS.has(local))) {
            return undefined;
        }
        let core: SourceElement | undefined;
        for (const child of children) {
            const own: SourceElement | undefined = this.coreOperator(child);
            if (own !== undefined && core === undefined) {
                core = own;
            } else if (own !== undefined || !this.isSpaceLike(child)) {
                return undefined;
            }
        }
        return core;
    }

    private isSpaceLike(element: SourceElement): boolean {
        // MathML Core §3.2.5.1: mtext, mspace, and a grouping element or mpadded "all of whose in-flow children are space-like".
        const local: string = element.getLocalName();
        return this.isMath(element) && (SPACE_LIKE_ELEMENTS.has(local)
            || (GROUPING_ELEMENTS.has(local) && this.shown(element).every((child: SourceElement) => this.isSpaceLike(child))));
    }

    private shown(element: SourceElement): Array<SourceElement> {
        // The MathML children that are rendered: the first of semantics (MathML Core §3.8) and the selected one of maction.
        const children: Array<SourceElement> = element.getChildren().filter((child: SourceElement) => this.isMath(child));
        if (element.getLocalName() === "semantics") {
            return children.slice(0, 1);
        }
        if (element.getLocalName() === "maction") {
            const chosen: SourceElement | undefined = element.getChildren()[this.selected(element) - 1];
            return chosen !== undefined && this.isMath(chosen) ? [chosen] : [];
        }
        return children;
    }

    private selected(action: SourceElement): number {
        // MathML 4 §3.7.1.1: selection "Specifies which child should be used for viewing", the first by default.
        const value: string | undefined = this.scopedAttribute(action, "selection")?.trim();
        const selection: number = value !== undefined && UNSIGNED_INTEGER.test(value) ? Number.parseInt(value, 10) : 1;
        return selection >= 1 && selection <= action.getChildren().length ? selection : 1;
    }

    private scopedAttribute(element: SourceElement, name: string): string | undefined {
        // §3.3.4.1: an mstyle changes "the default value for all elements within its scope", which an explicit value overrides;
        // MSTYLE_TARGETS holds the attributes that apply only to some elements, or that mstyle cannot set.
        const own: string | undefined = element.getAttributeValue(name);
        const targets: ReadonlySet<string> | undefined = MSTYLE_TARGETS.get(name);
        if (own !== undefined || (targets !== undefined && !targets.has(element.getLocalName()))) {
            return own;
        }
        for (let ancestor: SourceElement | undefined = element.getParent(); ancestor !== undefined && this.isMath(ancestor); ancestor = ancestor.getParent()) {
            const value: string | undefined = ancestor.getLocalName() === "mstyle" ? ancestor.getAttributeValue(name) : undefined;
            if (value !== undefined) {
                return value;
            }
        }
        return undefined;
    }

    private inheritedAttribute(element: SourceElement, name: string, valid: (value: string) => boolean): string | undefined {
        // §3.1.9.2: attributes that any presentation element, math included (§2.2.1), sets for itself and its descendants.
        for (let current: SourceElement | undefined = element; current !== undefined && this.isMath(current); current = current.getParent()) {
            const value: string | undefined = current.getAttributeValue(name)?.trim();
            if (value !== undefined && valid(value)) {
                return value;
            }
        }
        return undefined;
    }

    private collapsed(text: string): string {
        // §2.1.7: white space at the start and end is removed, and each run inside becomes one space.
        return text.replace(MATH_WHITE_SPACE, " ").trim();
    }

    classes(element: SourceElement): ReadonlyArray<string> | undefined {
        // MathML Core §2.1.4: class has "the same syntax and semantics" as on HTML elements, a set of space-separated tokens.
        const value: string | undefined = this.isMath(element) ? element.getAttributeValue("class") : undefined;
        return value === undefined ? undefined : value.split(SelectorMatcher.LIST_SEPARATOR).filter((token: string) => token.length > 0);
    }

    hints(element: SourceElement): ReadonlyArray<Declaration> {
        // The presentational hints of MathML Core §2.1.4 to §2.1.6, §3.2.2, §3.2.5 and §3.3.6.1, each given only by a valid value.
        let hints: ReadonlyArray<Declaration> | undefined = this.hinted.get(element);
        if (hints === undefined) {
            hints = this.isMath(element) ? this.readHints(element) : NO_DECLARATIONS;
            this.hinted.set(element, hints);
        }
        return hints;
    }

    private scriptSizeMultiplier(element: SourceElement): number | undefined {
        // MathML 4 §3.6.5.1: in mscarries "the inherited value ... should still override the default value, but the default
        // value, inside mscarries, should be 0.6".
        const value: string | undefined = this.inheritedAttribute(element, "scriptsizemultiplier", (text: string) => MATH_NUMBER.test(text));
        if (value !== undefined) {
            return Number.parseFloat(value);
        }
        for (let current: SourceElement | undefined = element; current !== undefined && this.isMath(current); current = current.getParent()) {
            if (current.getLocalName() === "mscarries") {
                return CARRIES_MULTIPLIER;
            }
        }
        return undefined;
    }

    private scriptMinSize(element: SourceElement): string {
        // §3.1.9.2: a length, 8pt by default.
        return this.named(this.inheritedAttribute(element, "scriptminsize", (text: string) => this.table.matchesType(LENGTH_PERCENTAGE, this.named(text) as string)))
            ?? SCRIPT_MIN_SIZE;
    }

    attachedDeclarations(element: SourceElement): ReadonlyArray<Declaration> {
        // MathML Core §2.1.4: style has the semantics of the HTML style attribute, whose declarations CSS Style Attributes reads
        // as a declaration list, with the element's base URL.
        let declarations: ReadonlyArray<Declaration> | undefined = this.attached.get(element);
        if (declarations === undefined) {
            const text: string | undefined = this.isMath(element) ? element.getAttributeValue("style") : undefined;
            declarations = text === undefined ? NO_DECLARATIONS : this.declarationList(text, this.urls.of(element));
            this.attached.set(element, declarations);
        }
        return declarations;
    }

    element(element: SourceElement, computed: (text: string) => CssValue | undefined): MathElement {
        // MathML Core §4.1: "Unknown MathML elements behave the same as the mrow element"; the attributes are those that
        // layout reads, their lengths computed with the element's font and their percentages kept for layout to resolve.
        const local: string = element.getLocalName();
        const math: MathElement = { name: CORE_ELEMENTS.has(local) || FULL_ELEMENTS.has(local) ? local : "mrow" };
        if (math.name === "menclose") {
            // MathML 4 §3.3.9.2: "a space separated list of notations", compared ASCII case-insensitively; none draws nothing.
            math.notations = (this.lower(this.scopedAttribute(element, "notation")) ?? "").split(MATH_WHITE_SPACE).filter((notation: string) => notation.length > 0);
        } else if (math.name === "mstack" || math.name === "mlongdiv") {
            this.stackAttributes(math, element, computed);
        } else if (math.name === "msgroup" || math.name === "msrow" || math.name === "mscarries" || math.name === "mscarry" || math.name === "msline") {
            this.stackItemAttributes(math, element, computed);
        } else if (math.name === "mo") {
            // §3.2.4.2: form "must be an ASCII case-insensitive match" of infix, prefix or postfix, the flags booleans, and the
            // spaces and sizes <length-percentage> values.
            const form: string | undefined = this.lower(this.scopedAttribute(element, "form"));
            if (form !== undefined && FORMS.has(form)) {
                math.form = form;
            }
            for (const flag of OPERATOR_FLAGS) {
                const value: boolean | undefined = this.boolean(this.scopedAttribute(element, flag));
                if (value !== undefined) {
                    math[flag] = value;
                }
            }
            for (const name of OPERATOR_LENGTHS) {
                const value: CssValue | undefined = this.lengthValue(this.scopedAttribute(element, name), computed);
                if (value !== undefined) {
                    math[name] = value;
                }
            }
        } else if (math.name === "mfrac") {
            // MathML 4 §3.3.2.2: linethickness also takes thin, medium and thick; numalign, denomalign and bevelled.
            const keyword: string | undefined = this.choice(this.scopedAttribute(element, "linethickness"), LINE_THICKNESSES);
            const thickness: CssValue | undefined = keyword === undefined ? this.lengthValue(this.scopedAttribute(element, "linethickness"), computed) : undefined;
            if (thickness !== undefined) {
                math.linethickness = thickness;
            } else if (keyword !== undefined) {
                math.lineThickness = keyword;
            }
            math.numAlign = this.choice(this.scopedAttribute(element, "numalign"), SCRIPT_ALIGNS) ?? "center";
            math.denomAlign = this.choice(this.scopedAttribute(element, "denomalign"), SCRIPT_ALIGNS) ?? "center";
            math.bevelled = this.boolean(this.scopedAttribute(element, "bevelled")) === true;
        } else if (math.name === "munder" || math.name === "mover" || math.name === "munderover") {
            // MathML 4 §3.4.4.2 and §3.4.5.2: without the attribute, the accent attribute of the script's core mo; and align.
            math.accent = math.name !== "munder" && this.accented(element, "accent");
            math.accentunder = math.name !== "mover" && this.accented(element, "accentunder");
            math.scriptAlign = this.choice(this.scopedAttribute(element, "align"), SCRIPT_ALIGNS) ?? "center";
        } else if (math.name === "msub" || math.name === "msup" || math.name === "msubsup" || math.name === "mmultiscripts") {
            // MathML 4 §3.4.1.2 to §3.4.3.2 and §3.4.7.2: "the minimum amount to shift the baseline" of the scripts.
            const subscript: number | undefined = math.name === "msup" ? undefined : this.pixels(this.scopedAttribute(element, "subscriptshift"), computed);
            const superscript: number | undefined = math.name === "msub" ? undefined : this.pixels(this.scopedAttribute(element, "superscriptshift"), computed);
            if (subscript !== undefined) {
                math.subscriptShift = subscript;
            }
            if (superscript !== undefined) {
                math.superscriptShift = superscript;
            }
        } else if (math.name === "mpadded") {
            // §3.3.6.1: each "absent, invalid or a percentage" attribute gives the default; voffset alone is not clamped.
            const height: number | undefined = this.pixels(element.getAttributeValue("height"), computed);
            const depth: number | undefined = this.pixels(element.getAttributeValue("depth"), computed);
            const space: number | undefined = this.pixels(element.getAttributeValue("lspace"), computed);
            const offset: number | undefined = this.pixels(element.getAttributeValue("voffset"), computed);
            if (height !== undefined) {
                math.height = Math.max(0, height);
            }
            if (depth !== undefined) {
                math.depth = Math.max(0, depth);
            }
            if (space !== undefined) {
                math.paddedSpace = Math.max(0, space);
            }
            if (offset !== undefined) {
                math.voffset = offset;
            }
        } else if (math.name === "mspace") {
            // §3.2.5: "the requested line-ascent is the resolved value of the height attribute, clamping negative values to 0".
            const height: number | undefined = this.pixels(this.scopedAttribute(element, "height"), computed);
            if (height !== undefined) {
                math.height = Math.max(0, height);
            }
        }
        if (math.name === "mo" || math.name === "mspace" || math.name === "math") {
            this.breakAttributes(math, element, computed);
        }
        return math;
    }

    private accented(scripted: SourceElement, attribute: "accent" | "accentunder"): boolean {
        // §3.4.4.2: "If underscript is an embellished operator, the accent attribute of the mo element at its core is used as the
        // default value", which the mo takes "set by dictionary (false)", and Appendix B gives no operator that property.
        const explicit: boolean | undefined = this.boolean(scripted.getAttributeValue(attribute));
        if (explicit !== undefined) {
            return explicit;
        }
        const position: number = attribute === "accent" && scripted.getLocalName() === "munderover" ? 2 : 1;
        const script: SourceElement | undefined = scripted.getChildren()[position];
        const core: SourceElement | undefined = script === undefined ? undefined : this.coreOperator(script);
        return core !== undefined && this.boolean(this.scopedAttribute(core, "accent")) === true;
    }

    private accentHints(hints: Array<Declaration>, element: SourceElement): void {
        // The rules of Appendix A for accents select the accent and accentunder attributes, so a default that the script gives
        // has the same effect as a hint: the accent keeps the font size, and the base of an overscript accent is compact.
        const parent: SourceElement | undefined = element.getParent();
        const name: string | undefined = parent !== undefined && this.isMath(parent) ? parent.getLocalName() : undefined;
        if (parent === undefined || name === undefined || !UNDER_OVER.has(name)) {
            return;
        }
        const index: number = parent.getChildren().indexOf(element);
        const under: boolean = name !== "mover" && this.boolean(parent.getAttributeValue("accentunder")) === undefined && this.accented(parent, "accentunder");
        const over: boolean = name !== "munder" && this.boolean(parent.getAttributeValue("accent")) === undefined && this.accented(parent, "accent");
        if ((index === 1 && (name === "mover" ? over : under)) || (index === 2 && name === "munderover" && over)) {
            this.add(hints, "font-size", "inherit");
        }
        if (index === 0 && over) {
            this.add(hints, "math-shift", "compact");
        }
    }

    private breakAttributes(math: MathElement, element: SourceElement, computed: (text: string) => CssValue | undefined): void {
        // MathML 4 §3.2.6.2.2 and §3.2.6.2.3: linebreak on mo and mspace, the others on mo, all of them defaulted by mstyle;
        // infixlinebreakstyle is an attribute of §3.1.9.2; §2.2.1: maxwidth and overflow on math, overflow linebreak by default.
        const own: string | undefined = this.choice(this.scopedAttribute(element, "linebreak"), LINE_BREAKS);
        if (own !== undefined) {
            math.lineBreak = own;
        }
        const style: string | undefined = this.choice(this.scopedAttribute(element, "linebreakstyle"), LINE_BREAK_STYLES);
        math.lineBreakStyle = style === "infixlinebreakstyle" || style === undefined
            ? this.choice(this.inheritedAttribute(element, "infixlinebreakstyle", (text: string) => this.choice(text, INFIX_STYLES) !== undefined), INFIX_STYLES) ?? "before"
            : style;
        math.lineBreakMultchar = this.scopedAttribute(element, "linebreakmultchar") ?? INVISIBLE_TIMES;
        const align: string | undefined = this.choice(this.scopedAttribute(element, "indentalign"), INDENT_ALIGNS);
        math.indentAlign = align === undefined || align === "indentalign" ? "auto" : align;
        const target: string | undefined = this.scopedAttribute(element, "indenttarget");
        if (target !== undefined) {
            math.indentTarget = target.trim();
        }
        const first: string | undefined = this.choice(this.scopedAttribute(element, "indentalignfirst"), INDENT_ALIGNS);
        const last: string | undefined = this.choice(this.scopedAttribute(element, "indentalignlast"), INDENT_ALIGNS);
        math.indentAlignFirst = first === undefined || first === "indentalign" ? math.indentAlign : first;
        math.indentAlignLast = last === undefined || last === "indentalign" ? math.indentAlign : last;
        const shift: CssValue | undefined = this.lengthValue(this.scopedAttribute(element, "indentshift"), computed);
        if (shift !== undefined) {
            math.indentShift = shift;
        }
        const shiftFirst: CssValue | undefined = this.lengthValue(this.scopedAttribute(element, "indentshiftfirst"), computed) ?? shift;
        const shiftLast: CssValue | undefined = this.lengthValue(this.scopedAttribute(element, "indentshiftlast"), computed) ?? shift;
        if (shiftFirst !== undefined) {
            math.indentShiftFirst = shiftFirst;
        }
        if (shiftLast !== undefined) {
            math.indentShiftLast = shiftLast;
        }
        const leading: CssValue | undefined = this.lengthValue(this.scopedAttribute(element, "lineleading"), computed);
        if (leading !== undefined) {
            math.lineLeading = leading;
        }
        if (math.name === "math") {
            const width: number | undefined = this.pixels(element.getAttributeValue("maxwidth"), computed);
            if (width !== undefined) {
                math.maxWidth = Math.max(0, width);
            }
            math.overflow = this.choice(element.getAttributeValue("overflow"), OVERFLOWS) ?? "linebreak";
        }
    }

    tableElement(element: SourceElement): MathElement {
        // MathML 4 §3.5.1.2: align is a keyword and an optional row number, counted from the bottom when negative; "When the
        // value of rownumber is out of range or not an integer, it is ignored."
        const math: MathElement = { name: "mtable" };
        // equalrows and equalcolumns force the rows and the columns to one size, and columnwidth has fit columns that share
        // what the other columns leave, which only the table layout knows.
        if (this.boolean(this.scopedAttribute(element, "equalrows")) === true) {
            math.equalRows = true;
        }
        if (this.boolean(this.scopedAttribute(element, "equalcolumns")) === true) {
            math.equalColumns = true;
        }
        const widths: Array<string> = (this.lower(this.scopedAttribute(element, "columnwidth")) ?? "").split(MATH_WHITE_SPACE).filter((part: string) => part.length > 0);
        if (widths.includes("fit")) {
            math.columnWidths = widths;
        }
        const parts: Array<string> = (this.lower(element.getAttributeValue("align")) ?? "").split(MATH_WHITE_SPACE).filter((part: string) => part.length > 0);
        if (parts.length === 0 || !TABLE_ALIGNS.has(parts[0])) {
            return math;
        }
        math.tableAlign = parts[0];
        const rows: number = element.getChildren().filter((child: SourceElement) => this.isMath(child) && child.getLocalName() === "mtr").length;
        const number: number = parts.length === 2 && SIGNED_ROW.test(parts[1]) ? Number.parseInt(parts[1], 10) : 0;
        if (number !== 0 && Math.abs(number) <= rows) {
            math.alignRow = number > 0 ? number : rows + number + 1;
        }
        return math;
    }

    cellElement(cell: SourceElement): MathElement | undefined {
        // §3.5.1.2: rowalign axis "aligns the axis of each cells", which no CSS alignment of table cells does.
        const row: SourceElement | undefined = cell.getParent();
        const table: SourceElement | undefined = row?.getParent();
        if (row === undefined || table === undefined || !this.isMath(table) || table.getLocalName() !== "mtable") {
            return undefined;
        }
        const index: number | undefined = this.cellSlots(table).get(cell)?.[0];
        const align: string | undefined = this.lower(cell.getAttributeValue("rowalign")) ?? this.lower(row.getAttributeValue("rowalign"))
            ?? (index === undefined ? undefined : this.listed(table, "rowalign", index));
        return align === "axis" ? { name: "mtd", axisAligned: true } : undefined;
    }

    spans(element: SourceElement): readonly [number, number] | undefined {
        // MathML Core §3.5.3: columnspan and rowspan of mtd parse as colspan and rowspan of HTML, which read a non-negative integer,
        // with 1 for a column span that is absent, invalid or zero, at most 1000, and a row span of zero spanning the group.
        if (!this.isMath(element) || element.getLocalName() !== "mtd") {
            return undefined;
        }
        const columns: RegExpExecArray | null = NON_NEGATIVE.exec(element.getAttributeValue("columnspan") ?? "");
        const rows: RegExpExecArray | null = NON_NEGATIVE.exec(element.getAttributeValue("rowspan") ?? "");
        const columnSpan: number = columns === null ? 1 : Math.min(MAXIMUM_COLUMN_SPAN, Math.max(1, Number.parseInt(columns[1], 10)));
        const rowSpan: number = rows === null ? 1 : Math.min(MAXIMUM_ROW_SPAN, Number.parseInt(rows[1], 10));
        return columnSpan === 1 && rowSpan === 1 ? undefined : [columnSpan, rowSpan];
    }

    private stackAttributes(math: MathElement, element: SourceElement, computed: (text: string) => CssValue | undefined): void {
        // MathML 4 §3.6.1.2 and §3.6.2.2; the decimal character, one character, is an attribute of §3.1.9.2.
        math.stackAlign = this.choice(this.scopedAttribute(element, "stackalign"), STACK_ALIGNS) ?? "decimalpoint";
        math.charAlign = this.choice(this.scopedAttribute(element, "charalign"), CHAR_ALIGNS) ?? "right";
        math.decimalCharacter = this.inheritedAttribute(element, "decimalcharacter", (text: string) => [...text].length === 1) ?? ".";
        const spacing: number | undefined = this.pixels(this.scopedAttribute(element, "charspacing"), computed);
        if (spacing !== undefined) {
            math.charSpacing = Math.max(0, spacing);
        }
        if (math.name === "mlongdiv") {
            math.longdivStyle = this.lower(this.scopedAttribute(element, "longdivstyle")) ?? "lefttop";
        }
        // §3.6.1.2: align has the values and meanings of mtable's, with baseline as the default and a row number counted in the stack.
        const parts: Array<string> = (this.lower(element.getAttributeValue("align")) ?? "").split(MATH_WHITE_SPACE).filter((part: string) => part.length > 0);
        math.tableAlign = parts.length > 0 && TABLE_ALIGNS.has(parts[0]) ? parts[0] : "baseline";
        if (parts.length === 2 && SIGNED_ROW.test(parts[1]) && Number.parseInt(parts[1], 10) !== 0) {
            math.alignRow = Number.parseInt(parts[1], 10);
        }
    }

    private stackItemAttributes(math: MathElement, element: SourceElement, computed: (text: string) => CssValue | undefined): void {
        // §3.6.3.2 to §3.6.7.2: position and shift are integers, location a compass point, crossout a list, and the line's length
        // an unsigned integer with overhangs and a thickness.
        const position: RegExpExecArray | null = INTEGER.exec(this.scopedAttribute(element, "position") ?? "");
        if (position !== null) {
            math.position = Number.parseInt(position[1], 10);
        }
        const shift: RegExpExecArray | null = math.name === "msgroup" ? INTEGER.exec(this.scopedAttribute(element, "shift") ?? "") : null;
        if (shift !== null) {
            math.shift = Number.parseInt(shift[1], 10);
        }
        const location: string | undefined = this.choice(this.scopedAttribute(element, "location"), LOCATIONS);
        if (location !== undefined) {
            math.location = location;
        }
        const crossout: string | undefined = this.lower(this.scopedAttribute(element, "crossout"));
        if (crossout !== undefined) {
            math.crossout = crossout.split(MATH_WHITE_SPACE).filter((value: string) => CROSSOUTS.has(value) && value !== "none");
        }
        if (math.name !== "msline") {
            return;
        }
        const length: RegExpExecArray | null = NON_NEGATIVE.exec(this.scopedAttribute(element, "length") ?? "");
        math.lineLength = length === null ? 0 : Number.parseInt(length[1], 10);
        math.leftOverhang = this.pixels(this.scopedAttribute(element, "leftoverhang"), computed) ?? 0;
        math.rightOverhang = this.pixels(this.scopedAttribute(element, "rightoverhang"), computed) ?? 0;
        const thickness: string | undefined = this.choice(this.scopedAttribute(element, "mslinethickness"), LINE_THICKNESSES);
        const width: number | undefined = thickness === undefined ? this.pixels(this.scopedAttribute(element, "mslinethickness"), computed) : undefined;
        if (width !== undefined) {
            math.lineWidth = Math.max(0, width);
        } else {
            math.lineThickness = thickness ?? "medium";
        }
    }

    private choice(value: string | undefined, allowed: ReadonlySet<string>): string | undefined {
        const lower: string | undefined = this.lower(value?.trim());
        return lower !== undefined && allowed.has(lower) ? lower : undefined;
    }

    private boolean(value?: string): boolean | undefined {
        // §2.1.2: "A string that is an ASCII case-insensitive match to true or false."
        const lower: string | undefined = this.lower(value);
        return lower === "true" ? true : (lower === "false" ? false : undefined);
    }

    private lengthValue(value: string | undefined, computed: (text: string) => CssValue | undefined): CssValue | undefined {
        const text: string | undefined = this.named(value);
        return text !== undefined && this.table.matchesType(LENGTH_PERCENTAGE, text) ? computed(text) : undefined;
    }

    private named(value: string | undefined): string | undefined {
        // MathML 4 §2.1.5.2: MathML Full lengths also accept a namedspace, ASCII case-insensitive, of ±n/18 em.
        if (value === undefined) {
            return undefined;
        }
        const lower: string = this.asciiCase.foldLower(value.trim());
        const negative: boolean = lower.startsWith(NEGATIVE_SPACE);
        const index: number = NAMED_SPACES.indexOf(negative ? lower.substring(NEGATIVE_SPACE.length) : lower);
        return index < 0 ? value : (negative ? "-" : "") + String((index + 1) / 18) + "em";
    }

    private pixels(given: string | undefined, computed: (text: string) => CssValue | undefined): number | undefined {
        // A value that keeps a percentage once computed has nothing for it to refer to.
        const text: string | undefined = this.named(given);
        const value: CssValue | undefined = text === undefined || PERCENTAGE.test(text) ? undefined : this.lengthValue(text, computed);
        return value !== undefined && value.kind === "length" ? value.px : undefined;
    }

    private readHints(element: SourceElement): ReadonlyArray<Declaration> {
        const hints: Array<Declaration> = [];
        const name: string = element.getLocalName();
        const dir: string | undefined = this.lower(element.getAttributeValue("dir"));
        if (dir !== undefined && DIRECTIONS.has(dir)) {
            this.add(hints, "direction", dir);
        }
        this.typed(hints, "color", element.getAttributeValue("mathcolor"), COLOR);
        this.typed(hints, "background-color", element.getAttributeValue("mathbackground"), COLOR);
        // MathML 4 §3.2.2: small and big "choose a size smaller or larger than the current font size", CSS's relative sizes, and
        // normal "is equivalent to 100%".
        const size: string | undefined = MATH_SIZES.get(this.lower(element.getAttributeValue("mathsize")?.trim()) ?? "");
        if (size !== undefined) {
            this.add(hints, "font-size", size);
        } else {
            this.typed(hints, "font-size", element.getAttributeValue("mathsize"), LENGTH_PERCENTAGE);
        }
        const displayStyle: string | undefined = this.lower(element.getAttributeValue("displaystyle"));
        if (displayStyle === "true" || displayStyle === "false") {
            this.add(hints, "math-style", displayStyle === "true" ? "normal" : "compact");
        }
        // §2.1.6: "+<U>, -<U> and <U> are respectively mapped to add(<U>) add(<-U>) and <U>", U an unsigned integer.
        const level: string | undefined = element.getAttributeValue("scriptlevel");
        const signed: RegExpExecArray | null = level === undefined ? null : SIGNED_INTEGER.exec(level);
        if (signed !== null) {
            this.add(hints, "math-depth", "add(" + (signed[1] === "-" ? "-" : "") + signed[2] + ")");
        } else if (level !== undefined && UNSIGNED_INTEGER.test(level)) {
            this.add(hints, "math-depth", level);
        }
        if (name === "mi" && this.lower(this.scopedAttribute(element, "mathvariant")) === "normal") {
            this.add(hints, "text-transform", "none");
        }
        if (name === "mtable") {
            this.tableHints(hints, element);
        } else if (name === "mtd") {
            this.cellHints(hints, element);
        }
        this.accentHints(hints, element);
        // MathML 4 §3.7.1.1: of the children of maction, only the selected sub-expression is rendered.
        const parent: SourceElement | undefined = element.getParent();
        if (parent !== undefined && this.isMath(parent) && parent.getLocalName() === "maction" && parent.getChildren()[this.selected(parent) - 1] !== element) {
            this.add(hints, "display", "none");
        }
        if (name === "mglyph") {
            // MathML 4 §3.2.1.1.2: width and height scale the image, the aspect ratio kept when only one is given, and a positive
            // valign "shifts the bottom of the image above the current baseline".
            this.typed(hints, "width", element.getAttributeValue("width"), LENGTH_PERCENTAGE);
            this.typed(hints, "height", element.getAttributeValue("height"), LENGTH_PERCENTAGE);
            this.typed(hints, "vertical-align", this.scopedAttribute(element, "valign"), LENGTH_PERCENTAGE);
        }
        if (name === "mspace" || name === "mpadded") {
            const width: string | undefined = this.length(this.scopedAttribute(element, "width"));
            if (width !== undefined) {
                this.add(hints, "width", width);
            }
        }
        if (name === "mspace") {
            // §3.2.5: both height and depth give "calc(" height " + " depth ")", and one of them alone gives itself.
            const height: string | undefined = this.length(this.scopedAttribute(element, "height"));
            const depth: string | undefined = this.length(this.scopedAttribute(element, "depth"));
            if (height !== undefined && depth !== undefined) {
                this.add(hints, "height", "calc(" + height + " + " + depth + ")");
            } else if (height !== undefined || depth !== undefined) {
                this.add(hints, "height", (height ?? depth) as string);
            }
        }
        return hints;
    }

    private tableHints(hints: Array<Declaration>, table: SourceElement): void {
        // MathML 4 §3.5.1.2: "the desired width of the entire table", and a frame with framespacing between it and the table, whose
        // "first value specifies the spacing on the right and left; the second value ... above and below".
        this.typed(hints, "width", table.getAttributeValue("width"), LENGTH_PERCENTAGE);
        if (hints.some((hint: Declaration) => hint.property === "width")) {
            this.add(hints, "box-sizing", "border-box");
        }
        const frame: string | undefined = this.lower(this.scopedAttribute(table, "frame"));
        if (frame === undefined || !LINE_STYLES.has(frame)) {
            return;
        }
        this.add(hints, "border", "thin " + frame);
        const spacing: Array<string> = (this.scopedAttribute(table, "framespacing") ?? "").split(MATH_WHITE_SPACE).filter((part: string) => part.length > 0);
        const across: string = spacing[0] !== undefined && this.table.matchesType(LENGTH_PERCENTAGE, spacing[0]) ? spacing[0] : COLUMN_EDGE;
        const down: string = spacing[1] !== undefined && this.table.matchesType(LENGTH_PERCENTAGE, spacing[1]) ? spacing[1] : ROW_EDGE;
        this.add(hints, "padding", down + " " + across);
    }

    private cellHints(hints: Array<Declaration>, cell: SourceElement): void {
        // §3.5.1.2 to §3.5.3.2: the alignments of a cell come from the cell, then its row, then the table's list for its row or
        // column; the spacings and lines of the table lists apply to the gaps next to the cell.
        const row: SourceElement | undefined = cell.getParent();
        const table: SourceElement | undefined = row?.getParent();
        if (row === undefined || table === undefined || !this.isMath(table) || table.getLocalName() !== "mtable") {
            return;
        }
        const slot: readonly [number, number, number, number] | undefined = this.cellSlots(table).get(cell);
        const extent: readonly [number, number] | undefined = this.extents.get(table);
        if (slot === undefined || extent === undefined) {
            return;
        }
        const [rowIndex, column, rowSpan, columnSpan]: readonly [number, number, number, number] = slot;
        const columnAlign: string | undefined = this.lower(cell.getAttributeValue("columnalign")) ?? this.listed(row, "columnalign", column) ?? this.listed(table, "columnalign", column);
        if (columnAlign !== undefined && COLUMN_ALIGNS.has(columnAlign)) {
            this.add(hints, "text-align", columnAlign);
        }
        const rowAlign: string | undefined = ROW_ALIGNS.get(this.lower(cell.getAttributeValue("rowalign")) ?? this.lower(row.getAttributeValue("rowalign"))
            ?? this.listed(table, "rowalign", rowIndex) ?? "");
        if (rowAlign !== undefined) {
            this.add(hints, "vertical-align", rowAlign);
        }
        if (this.scopedAttribute(table, "columnspacing") !== undefined) {
            this.add(hints, "padding-inline-start", this.halfGap(table, "columnspacing", column - 1, COLUMN_EDGE));
            this.add(hints, "padding-inline-end", this.halfGap(table, "columnspacing", column + columnSpan - 1 < extent[1] - 1 ? column + columnSpan - 1 : -1, COLUMN_EDGE));
        }
        if (this.scopedAttribute(table, "rowspacing") !== undefined) {
            this.add(hints, "padding-block-start", this.halfGap(table, "rowspacing", rowIndex - 1, ROW_EDGE));
            this.add(hints, "padding-block-end", this.halfGap(table, "rowspacing", rowIndex + rowSpan - 1 < extent[0] - 1 ? rowIndex + rowSpan - 1 : -1, ROW_EDGE));
        }
        const rowLine: string | undefined = rowIndex + rowSpan < extent[0] ? this.listed(table, "rowlines", rowIndex + rowSpan - 1) : undefined;
        if (rowLine !== undefined && LINE_STYLES.has(rowLine)) {
            this.add(hints, "border-block-end", "thin " + rowLine);
        }
        const columnLine: string | undefined = column + columnSpan < extent[1] ? this.listed(table, "columnlines", column + columnSpan - 1) : undefined;
        if (columnLine !== undefined && LINE_STYLES.has(columnLine)) {
            this.add(hints, "border-inline-end", "thin " + columnLine);
        }
        const width: string | undefined = columnSpan === 1 ? this.listed(table, "columnwidth", column) : undefined;
        if (width !== undefined && this.table.matchesType(LENGTH_PERCENTAGE, width)) {
            // §3.5.1.2: "an explicit length means that the column is exactly that wide", its padding and lines included.
            this.add(hints, "width", width);
            this.add(hints, "box-sizing", "border-box");
        }
    }

    private halfGap(table: SourceElement, name: string, gap: number, edge: string): string {
        // A gap is shared by the two cells next to it; at the edges of the table the cell keeps the padding of MathML Core.
        const value: string | undefined = gap < 0 ? undefined : this.listed(table, name, gap);
        return value === undefined || !this.table.matchesType(LENGTH_PERCENTAGE, value) ? edge : "calc(" + value + " / 2)";
    }

    private listed(element: SourceElement, name: string, index: number): string | undefined {
        // §3.5.1.2: "If there are more rows ... than supplied values, the last value is repeated as needed", and the excess
        // values are ignored.
        const values: Array<string> = (this.lower(this.scopedAttribute(element, name)) ?? "").split(MATH_WHITE_SPACE).filter((value: string) => value.length > 0);
        return values.length === 0 ? undefined : values[Math.min(index, values.length - 1)];
    }

    private cellSlots(table: SourceElement): ReadonlyMap<SourceElement, readonly [number, number, number, number]> {
        // The row, column and spans of each cell, with the slots that the row spans of rows above take skipped, as HTML's
        // algorithm for processing rows does; the table's row and column counts are kept beside them.
        let known: ReadonlyMap<SourceElement, readonly [number, number, number, number]> | undefined = this.slots.get(table);
        if (known !== undefined) {
            return known;
        }
        const result: Map<SourceElement, readonly [number, number, number, number]> = new Map<SourceElement, readonly [number, number, number, number]>();
        const rows: Array<SourceElement> = table.getChildren().filter((child: SourceElement) => this.isMath(child) && child.getLocalName() === "mtr");
        const covered: Array<number> = [];
        let columns: number = 0;
        rows.forEach((row: SourceElement, index: number) => {
            let column: number = 0;
            for (const cell of row.getChildren().filter((child: SourceElement) => this.isMath(child) && child.getLocalName() === "mtd")) {
                while ((covered[column] ?? 0) > 0) {
                    column++;
                }
                const spans: readonly [number, number] = this.spans(cell) ?? [1, 1];
                const rowSpan: number = spans[1] === 0 ? rows.length - index : spans[1];
                result.set(cell, [index, column, rowSpan, spans[0]]);
                for (let next: number = column; next < column + spans[0]; next++) {
                    covered[next] = rowSpan;
                }
                column += spans[0];
                columns = Math.max(columns, column);
            }
            for (let next: number = 0; next < covered.length; next++) {
                covered[next] = Math.max(0, (covered[next] ?? 0) - 1);
            }
        });
        known = result;
        this.slots.set(table, known);
        this.extents.set(table, [rows.length, columns]);
        return known;
    }

    private length(given: string | undefined): string | undefined {
        // §3.2.5 and §3.3.6.1: a width, height or depth that is "present, valid and not a percentage".
        const value: string | undefined = this.named(given);
        return value !== undefined && this.table.matchesType(LENGTH_PERCENTAGE, value) && !PERCENTAGE.test(value) ? value : undefined;
    }

    private typed(hints: Array<Declaration>, property: string, given: string | undefined, type: string): void {
        const value: string | undefined = type === LENGTH_PERCENTAGE ? this.named(given) : given;
        if (value !== undefined && this.table.matchesType(type, value)) {
            this.add(hints, property, value);
        }
    }

    private add(hints: Array<Declaration>, property: string, value: string): void {
        hints.push(...this.declarationList(property + ": " + value, "about:blank"));
    }

    declared(text: string): Map<string, DeclaredValue> {
        // Declarations given to an anonymous box of a formula, as the cascade would give them.
        return new Map<string, DeclaredValue>(this.declarationList(text, "about:blank").map((declaration: Declaration): [string, DeclaredValue] =>
            [declaration.property, declaration.value]));
    }

    private declarationList(text: string, baseUrl: string): ReadonlyArray<Declaration> {
        let list: CssNode;
        try {
            list = parse(text, { context: "declarationList" });
        } catch {
            return NO_DECLARATIONS;
        }
        const declarations: Array<Declaration> = [];
        if (list.type === "DeclarationList") {
            for (const node of list.children) {
                const read: Array<Declaration> | undefined = node.type === "Declaration" ? this.reader.read(node as CssTreeDeclaration, baseUrl, DeclarationReader.NO_NAMESPACES) : undefined;
                if (read !== undefined) {
                    declarations.push(...read);
                }
            }
        }
        return declarations;
    }

    private lower(value?: string): string | undefined {
        return value === undefined ? undefined : this.asciiCase.foldLower(value);
    }
}
