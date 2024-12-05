import type { Expression, TemplateLiteral } from "oxc-parser";

type Hook<T> = (input: unknown) => input is T;
export function recursiveFind<T>(input: unknown, hook: Hook<T>): T[] | undefined {
	if (!input) return;
	if (hook(input)) return [input];
	if (typeof input === "object") {
		return Object.values(input)
			.flatMap((value) => recursiveFind(value, hook))
			.filter(hook);
	}
}

export function toPascalCase(text: string) {
	return text
		.split("_")
		.map((word) => word[0].toUpperCase() + word.slice(1))
		.join("");
}

export function templateLiteralToStaticString(input: TemplateLiteral): string {
	const getExpressionName = (expression: Expression): string => {
		if (expression.type === "Identifier") return `{${expression.name}}`;
		if (expression.type === "PrivateFieldExpression") return `{#${expression.field.name}}`;
		throw new Error(`Unsupported expression type: ${expression.type}`);
	};
	// merge quasis and expressions into a single string
	return input.quasis.reduce((acc, quasi, index) => {
		return acc + quasi.value.raw + (input.expressions[index] ? getExpressionName(input.expressions[index]) : "");
	}, "");
}

export function isPrimitiveType(value: unknown): value is "boolean" | "number" | "string" {
	return typeof value === "string" && ["boolean", "number", "string"].includes(value);
}
