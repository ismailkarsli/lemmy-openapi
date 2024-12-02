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
