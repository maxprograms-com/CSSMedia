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

import { DOMBuilder, XMLAttribute } from "typesxml";
import { SourceElement } from "./SourceElement.js";

export class SourceDOMBuilder extends DOMBuilder {

    static readonly XML_NAMESPACE: string = "http://www.w3.org/XML/1998/namespace";
    private static readonly ABSOLUTE: RegExp = /^[A-Za-z][A-Za-z0-9+.-]*:/;

    private readonly prefixes: Map<string, string> = new Map<string, string>([
        ["xml", SourceDOMBuilder.XML_NAMESPACE]
    ]);

    private readonly scopes: Array<readonly [SourceElement, XMLAttribute]> = [];
    private rootNamespace?: string;

    getPrefixes(): ReadonlyMap<string, string> {
        return this.prefixes;
    }

    override startElement(name: string, atts: Array<XMLAttribute>): void {
        const element: SourceElement = new SourceElement(name);
        const parent: SourceElement | undefined = this.stack.length === 0 ? undefined : this.stack[this.stack.length - 1] as SourceElement;
        let language: string | undefined = parent?.getLanguage();
        let base: string | undefined = parent?.getBase();
        let declared: XMLAttribute | undefined;
        for (const att of atts) {
            element.setAttribute(att);
            const attribute: string = att.getName();
            if (attribute === "xmlns") {
                declared = att;
            } else if (attribute.startsWith("xmlns:")) {
                this.bind(attribute.substring(6), att.getValue());
            } else if (attribute === "xml:lang") {
                language = att.getValue();
            } else if (attribute === "xml:base") {
                base = this.baseOf(att.getValue(), base);
            }
        }
        // XML 1.0 §2.12: xml:lang applies "to all attributes and content of the element where it is specified, unless
        // overridden with an instance of xml:lang on another element within that content".
        element.setLanguage(language);
        element.setBase(base);
        if (declared !== undefined) {
            this.scopes.push([element, declared]);
            if (parent === undefined) {
                this.rootNamespace = declared.getValue();
            }
        } else if (this.scopes.length > 0) {
            // An element answers for its namespace from its own attribute, or else from the root's, which needs no copies.
            const scope: XMLAttribute = this.scopes[this.scopes.length - 1][1];
            if (scope.getValue() !== this.rootNamespace) {
                element.setAttribute(scope);
            }
        }
        if (parent === undefined) {
            this.document?.setRoot(element);
        } else {
            parent.addElement(element);
        }
        this.stack.push(element);
    }

    override endElement(name: string): void {
        if (this.scopes.length > 0 && this.scopes[this.scopes.length - 1][0] === this.stack[this.stack.length - 1]) {
            this.scopes.pop();
        }
        super.endElement(name);
    }

    private bind(prefix: string, uri: string): void {
        const known: string | undefined = this.prefixes.get(prefix);
        if (known !== undefined && known !== uri) {
            throw new Error("The prefix " + prefix + " is bound to " + known + " and to " + uri + ": redefining a namespace URI is not supported");
        }
        this.prefixes.set(prefix, uri);
    }

    private baseOf(declared: string, inherited?: string): string {
        // An xml:base value may be relative, and then it adds to the base declared above it; the address of the document,
        // which the element's base is resolved against when it is used, is not part of what is kept here.
        if (inherited === undefined || SourceDOMBuilder.ABSOLUTE.test(declared)) {
            return declared;
        }
        if (SourceDOMBuilder.ABSOLUTE.test(inherited)) {
            if (!URL.canParse(inherited)) {
                return inherited;
            }
            return URL.canParse(declared, inherited) ? new URL(declared, inherited).href : declared;
        }
        if (declared.startsWith("/")) {
            return declared;
        }
        const slash: number = inherited.lastIndexOf("/");
        return inherited.startsWith("//") && slash < 2 ? inherited + "/" + declared : inherited.substring(0, slash + 1) + declared;
    }

    override startCDATA(): void {
        // CDATA sections are character data: their content reaches characters() and joins the text around it.
    }

    override endCDATA(): void {
        // do nothing
    }
}
