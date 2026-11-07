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

import type { Catalog, ContentHandler, Grammar, XMLAttribute } from "typesxml";

export class XmlRootHandler implements ContentHandler {

    name?: string;
    attributes?: Array<XMLAttribute>;
    private grammar?: Grammar;

    localName(): string | undefined {
        return this.name?.substring(this.name.indexOf(":") + 1);
    }

    namespace(): string | undefined {
        const colon: number = this.name === undefined ? -1 : this.name.indexOf(":");
        const declaration: string = colon < 0 ? "xmlns" : "xmlns:" + (this.name as string).substring(0, colon);
        return this.attributes?.find((attribute: XMLAttribute) => attribute.getName() === declaration)?.getValue();
    }

    initialize(): void {
        delete this.name;
        delete this.attributes;
    }

    setCatalog(catalog: Catalog): void {
        // do nothing
    }

    startDocument(): void {
        // do nothing
    }

    endDocument(): void {
        // do nothing
    }

    xmlDeclaration(version: string, encoding: string, standalone: string | undefined): void {
        // do nothing
    }

    startElement(name: string, atts: XMLAttribute[]): void {
        this.name = name;
        this.attributes = atts;
        throw new Error("The document element " + name + " has been read");
    }

    endElement(name: string): void {
        // do nothing
    }

    internalSubset(declaration: string): void {
        // do nothing
    }

    characters(text: string): void {
        // do nothing
    }

    ignorableWhitespace(text: string): void {
        // do nothing
    }

    comment(text: string): void {
        // do nothing
    }

    processingInstruction(target: string, data: string): void {
        // do nothing
    }

    startCDATA(): void {
        // do nothing
    }

    endCDATA(): void {
        // do nothing
    }

    startDTD(name: string, publicId: string, systemId: string): void {
        // do nothing
    }

    endDTD(): void {
        // do nothing
    }

    skippedEntity(name: string): void {
        // do nothing
    }

    getGrammar(): Grammar | undefined {
        return this.grammar;
    }

    setGrammar(grammar: Grammar | undefined): void {
        if (grammar === undefined) {
            delete this.grammar;
        } else {
            this.grammar = grammar;
        }
    }

    getCurrentText(): string {
        return "";
    }
}
