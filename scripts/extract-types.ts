import { VERSION } from "../lemmy-js-client/src/other_types.ts";
import type { OpenAPIV3 } from "openapi-types";
import oxc, { type TSTypeParameterInstantiation } from "oxc-parser";
import { createIs } from "typia";
import { stringify as YAMLStringify } from "yaml";
import { recursiveFind, toPascalCase } from "../utils.ts";

const sourceText = await Bun.file("lemmy-js-client/src/http.ts").text();
const parsed = await oxc.parseAsync(sourceText, { sourceFilename: "http.ts", sourceType: "module" });
await Bun.write("output/program.json", JSON.stringify(parsed, null, 2));

interface LemmyMethod {
	type: "MethodDefinition";
	key: {
		type: "Identifier";
		name: string; // method name
	};
	start: number;
	end: number;
	value: {
		type: "FunctionExpression";
		body: {
			type: "FunctionBody";
			statements: [
				{
					type: "ReturnStatement";
					argument: {
						type: "CallExpression";
						callee: {
							type: "PrivateFieldExpression";
							field: { type: "PrivateIdentifier"; name: "wrapper" };
						};
						typeParameters: TSTypeParameterInstantiation; // [input type, output type]
						arguments: [
							{ type: "StaticMemberExpression"; property: { name: string } }, // HTTP method
							{ type: "Literal"; value: string }, // endpoint
							...unknown[],
						];
					};
				},
			];
		};
	};
}
const lemmyMethods = recursiveFind(parsed.program.body, createIs<LemmyMethod>());
if (!lemmyMethods) throw new Error("Could not find wrapper calls");

const pathStatements = lemmyMethods.map((lemmyMethod) => {
	const methodName = lemmyMethod.key.name;
	const [methodArg, endpointArg] = lemmyMethod.value.body.statements[0].argument.arguments;
	const [inputParam, outputParam] = lemmyMethod.value.body.statements[0].argument.typeParameters.params;

	const method = methodArg.property.name.toUpperCase();
	const endpoint = endpointArg.value;
	const inputType =
		inputParam.type === "TSTypeReference" && inputParam.typeName.type === "Identifier"
			? inputParam.typeName.name
			: undefined;
	const outputType =
		outputParam.type === "TSTypeReference" && outputParam.typeName.type === "Identifier"
			? outputParam.typeName.name
			: undefined;

	// if the comments end is within 10 characters of the method start, it's probably a comment for the method
	const description = parsed.comments.find(
		(comment) => lemmyMethod.start - comment.end < 10 && lemmyMethod.start - comment.end > 0,
	)?.value;
	return {
		name: methodName,
		method,
		endpoint,
		inputType,
		outputType,
		// clear out the HTTP method and endpoint from the description
		description: description
			?.split("\n")
			.map((block) =>
				block
					.replace("*", "")
					.replace(/`HTTP\.(\w+) \/(.+)`/, "")
					.trim(),
			)
			.filter(Boolean)
			.join("\n"),
	};
});

const imports = Array.from(
	new Set(pathStatements.flatMap((method) => [method?.inputType, method?.outputType]).filter((i): i is string => !!i)),
);
const typesFile = `
import type { ${imports.join(", ")} } from "../lemmy-js-client/src/index";
import { application } from "typia/lib/json";
export const components = application<[${imports.join(", ")}], "3.0">().components;
`;
await Bun.write("output/components.ts", typesFile);
// @ts-ignore it does not exists initially
const components = await import("../output/components.ts");
const paths: OpenAPIV3.PathsObject = {};
const tags = new Set<string>();

for (const method of pathStatements) {
	const tag =
		method.endpoint.split("/").slice(1, -1).map(toPascalCase).join("/") ||
		toPascalCase(method.endpoint.split("/").at(-1) || "");
	if (tag) tags.add(tag);
	paths[method.endpoint] ??= {};
	// biome-ignore lint/style/noNonNullAssertion: we defined it one line above
	paths[method.endpoint]![method.method.toLowerCase() as "put" | "get" | "post"] = {
		operationId: method.name,
		description: method.description,
		parameters:
			method.inputType && method.method === "GET"
				? // @ts-expect-error
					Object.keys(components.schemas?.[method.inputType]?.properties || {}).map((name) => ({
						name,
						in: "query",
						schema: {
							$ref: `#/components/schemas/${method.inputType}/properties/${name}`,
						},
					}))
				: undefined,
		requestBody:
			method.inputType && method.method !== "GET"
				? {
						content: {
							"application/json": {
								schema: {
									$ref: `#/components/schemas/${method.inputType}`,
								},
							},
						},
					}
				: undefined,
		tags: tag ? [tag] : undefined,
		responses: {
			200: method.outputType
				? {
						description: "Successful response",
						content: {
							"application/json": {
								schema: {
									$ref: `#/components/schemas/${method.outputType}`,
								},
							},
						},
					}
				: {
						description: "No content",
					},
		},
	};
}

const schema = {
	openapi: "3.0.3",
	info: {
		title: "Lemmy API",
		version: process.env.LEMMY_VERSION || "0.0.1",
	},
	servers: process.env.LEMMY_URL ? [{ url: `${process.env.LEMMY_URL}/api/${VERSION}` }] : undefined,
	security: [{ bearerAuth: [] }],
	externalDocs: {
		description: "Official Lemmy documentation",
		url: "https://join-lemmy.org/api/index.html",
	},
	tags: Array.from(tags).map((tag) => ({ name: tag })),
	paths,
	// @ts-expect-error
	components: {
		...components.components,
		securitySchemes: {
			bearerAuth: {
				type: "http",
				scheme: "bearer",
				bearerFormat: "JWT",
				description: "Login from the /user/login endpoint to get a JWT token",
			},
		},
	},
} satisfies OpenAPIV3.Document;

// hotfix: some deprecated fields have "null" as type which is not allowed. We should remove them
// biome-ignore lint/suspicious/noExplicitAny: don't care
function removeNullTypes(obj: any) {
	for (const key in obj) {
		if (key === "type" && obj[key] === "null") {
			delete obj[key];
		}
		if (typeof obj[key] === "object") {
			removeNullTypes(obj[key]);
		}
	}
}
removeNullTypes(schema.components.schemas);

await Bun.write("output/openapi.json", JSON.stringify(schema, null, 2));
await Bun.write("output/openapi.yaml", YAMLStringify(schema));
