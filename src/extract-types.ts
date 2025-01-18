#!/usr/bin/env bun

import type { OpenAPIV3 } from "openapi-types";
import oxc, {
	type StringLiteral,
	type FormalParameters,
	type IdentifierName,
	type TSTypeParameterInstantiation,
	type VariableDeclarator,
} from "oxc-parser";
import { createIs, is } from "typia";
import { stringify as YAMLStringify } from "yaml";
import { isPrimitiveType, recursiveFind, templateLiteralToStaticString, toPascalCase } from "./utils.ts";

// @ts-ignore: it will be available when we clone the repo
const { VERSION: API_VERSION } = await import("../lemmy-js-client/src/other_types.ts").catch(() => ({ VERSION: "v3" }));

const sourceText = await Bun.file(`${import.meta.dir}/../lemmy-js-client/src/http.ts`).text();
const parsed = await oxc.parseAsync("http.ts", sourceText, { sourceType: "module" });
// save the parsed file in development mode
if (process.env.NODE_ENV === "development") {
	await Bun.write(`${import.meta.dir}/tmp/program.json`, JSON.stringify(parsed, null, 2));
}

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
		params?: unknown;
		body: {
			type: "FunctionBody";
			statements: Array<WrapperStatement | unknown>;
		};
		returnType?: ReturnType | unknown;
	};
}

interface WrapperStatement {
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
}

interface Parameter {
	type: "FormalParameter";
	pattern: {
		typeAnnotation: {
			type: "TSTypeAnnotation";
			typeAnnotation: {
				type: "TSTypeReference";
				typeName: { type: "Identifier"; name: string };
			};
		};
	};
}

interface ReturnType {
	type: "TSTypeAnnotation";
	typeAnnotation: {
		type: "TSTypeReference";
		typeName: { type: "Identifier"; name: string };
		typeParameters: {
			type: "TSTypeParameterInstantiation";
			params: [
				{ type: "TSTypeReference"; typeName: { type: "Identifier"; name: string } } | { type: "TSBooleanKeyword" },
			];
		};
	};
}

interface FetchStatement {
	type: "CallExpression";
	callee: {
		type: "PrivateFieldExpression";
		field: { type: "PrivateIdentifier"; name: "fetchFunction" };
	};
	arguments: [
		PictrsUrlObject | BuildFullUrl | unknown,
		{ type: "ObjectExpression"; properties: Array<FetchMethod | unknown> },
	];
}

interface UploadStatement {
	type: "CallExpression";
	callee: {
		type: "PrivateFieldExpression";
		field: { type: "PrivateIdentifier"; name: "upload" };
	};
	arguments: [{ type: "Literal"; value: string }, { type: "Identifier"; name: string }, ...unknown[]];
}

interface PictrsUrlObject {
	type: "PrivateFieldExpression";
	field: { type: "PrivateIdentifier"; name: "pictrsUrl" };
}

interface BuildFullUrl {
	type: "CallExpression";
	callee: { type: "PrivateFieldExpression"; field: { type: "PrivateIdentifier"; name: "buildFullUrl" } };
	arguments: [{ type: "Literal"; value: string }];
}

type FetchMethod = {
	type: "ObjectProperty";
	key: { type: "Identifier"; name: "method" };
	value: {
		type: "StaticMemberExpression";
		object: { type: "Identifier"; name: "HttpType" };
		property: { type: "Identifier"; name: "Get" | "Post" | "Put" | "Delete" };
	};
};

const lemmyMethods = recursiveFind(parsed.program.body, createIs<LemmyMethod>());
if (!lemmyMethods?.length) throw new Error("Could not find wrapper calls");
console.info(`Found ${lemmyMethods.length} methods`);

const pathStatements = lemmyMethods
	.map((lemmyMethod) => {
		const methodName = lemmyMethod.key.name;
		if (methodName === "constructor" || methodName === "setHeaders") return;
		const returnStatement = lemmyMethod.value.body.statements.find(createIs<WrapperStatement>());
		let method: string;
		let endpoint: string;
		let inputType: string | undefined;
		let outputType: string | undefined;
		let urlParameters: string[] = [];
		// we're looking for either `return this.#wrapper()` or `this.#fetchFunction()` calls
		if (returnStatement) {
			const [methodArg, endpointArg] = returnStatement.argument.arguments;
			const [inputParam, outputParam] = returnStatement.argument.typeParameters.params;

			method = methodArg.property.name.toUpperCase();
			endpoint = endpointArg.value;
			inputType =
				inputParam.type === "TSTypeReference" && inputParam.typeName.type === "Identifier"
					? inputParam.typeName.name
					: undefined;
			outputType =
				outputParam.type === "TSTypeReference" && outputParam.typeName.type === "Identifier"
					? outputParam.typeName.name
					: undefined;
		} else {
			const fetchStatement = recursiveFind(lemmyMethod.value.body.statements, createIs<FetchStatement>())?.at(-1);
			const uploadStatement = recursiveFind(lemmyMethod.value.body.statements, createIs<UploadStatement>())?.at(-1);
			if (!fetchStatement && !uploadStatement) {
				throw new Error(`Could not find fetch, upload or return statements for "${methodName}"`);
			}

			if (fetchStatement) {
				const methodProperty = fetchStatement.arguments[1].properties.find(createIs<FetchMethod>());
				if (!methodProperty) throw new Error("Could not find method property");
				method = methodProperty.value.property.name.toUpperCase();
			} else {
				method = "POST"; // upload is always POST
			}

			if (fetchStatement) {
				if (is<StringLiteral>(fetchStatement.arguments[0])) {
					endpoint = fetchStatement.arguments[0].value;
				} else if (is<PictrsUrlObject>(fetchStatement.arguments[0])) {
					endpoint = "/pictrs/image";
				} else if (is<IdentifierName>(fetchStatement.arguments[0])) {
					const varName = fetchStatement.arguments[0].name;
					// find the variable declaration and get the value
					const variableDeclarations = recursiveFind(lemmyMethod.value.body.statements, createIs<VariableDeclarator>());
					if (!variableDeclarations) {
						throw new Error(`Could not find variables for ${JSON.stringify(varName)} in ${methodName}`);
					}
					const variable = variableDeclarations.find((v) => v.id.type === "Identifier" && v.id.name === varName);
					if (!variable) throw new Error(`Could not find variable ${varName} in ${methodName}`);
					if (variable.init?.type === "Literal" && variable.init.raw) {
						endpoint = variable.init.raw;
					} else if (variable.init?.type === "TemplateLiteral") {
						endpoint = templateLiteralToStaticString(variable.init).replace("{#pictrsUrl}", "/pictrs/image");
						const urlParams = endpoint.match(/{(.+?)}/g);
						if (urlParams) {
							urlParameters = urlParams.map((param) => param.slice(1, -1));
						}
					} else {
						throw new Error(`Could not find endpoint for ${varName} in ${methodName}`);
					}
				} else if (is<BuildFullUrl>(fetchStatement.arguments[0])) {
					endpoint = fetchStatement.arguments[0].arguments[0].value;
				} else {
					throw new Error("Could not find fetch url");
				}
			} else if (uploadStatement) {
				endpoint = uploadStatement.arguments[0].value;
			} else throw new Error("no upload statement");

			const firstParameter = (lemmyMethod.value.params as FormalParameters)?.items.at(0);
			if (!is<Parameter>(firstParameter)) throw new Error(`Could not find first parameter for ${methodName}`);
			inputType = firstParameter.pattern.typeAnnotation.typeAnnotation.typeName.name;
			const returnType = lemmyMethod.value.returnType;
			if (!is<ReturnType>(returnType)) throw new Error(`Could not find return type for ${methodName}`);
			if (returnType.typeAnnotation.typeParameters.params[0].type === "TSBooleanKeyword") {
				outputType = "boolean";
			} else {
				outputType = returnType?.typeAnnotation.typeParameters.params[0].typeName.name;
			}
		}

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
			urlParameters,
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
	})
	.filter((i): i is Exclude<typeof i, undefined> => !!i);

const imports = Array.from(
	new Set(pathStatements.flatMap((method) => [method?.inputType, method?.outputType]).filter((i): i is string => !!i)),
);
const typesFile = `
import type { ${imports.join(", ")} } from "../../lemmy-js-client/src/index";
import { application } from "typia/lib/json";
export const components = application<[${imports.join(", ")}], "3.0">().components;
`;
await Bun.write(`${import.meta.dir}/tmp/components.ts`, typesFile);
// @ts-ignore it does not exists initially
const components = await import("./tmp/components.ts");
const paths: OpenAPIV3.PathsObject = {};
const allTags = new Set<string>();
const usedTags = new Set<string>();

const getTag = (endpoint: string) =>
	endpoint
		.split("/")
		.filter((part) => !part.includes("{"))
		.slice(1)
		.map(toPascalCase)
		.join("/");

// we need to add these before the paths because we need to check child tags
for (const { endpoint } of pathStatements) allTags.add(getTag(endpoint));

for (const method of pathStatements) {
	let tag = getTag(method.endpoint);
	const hasChild = Array.from(allTags).some((t) => t.startsWith(`${tag}/`));
	// if the tag has no child and is not a root path, we need to remove the last part
	if (!hasChild && tag.split("/").length !== 1) tag = tag.split("/").slice(0, -1).join("/");
	usedTags.add(tag);

	const parameters: OpenAPIV3.ParameterObject[] = method.urlParameters.map((name) => ({
		name,
		in: "path",
		required: true,
		schema: { type: "string" },
	}));
	if (method.inputType && method.method === "GET") {
		parameters.push(
			// @ts-ignore: we know that components.components.schemas is defined
			...Object.keys(components.components.schemas?.[method.inputType]?.properties || {}).map((name) => ({
				name,
				in: "query",
				schema: {
					$ref: `#/components/schemas/${method.inputType}/properties/${name}`,
				},
			})),
		);
	}

	let requestBody: OpenAPIV3.RequestBodyObject | undefined;
	if (method.inputType && method.method !== "GET") {
		requestBody = {
			content: {
				"application/json": {
					schema: {
						$ref: `#/components/schemas/${method.inputType}`,
					},
				},
			},
		};
	}
	// if the type has binary we need to use the "multipart/form-data" content type
	if (
		method.inputType &&
		requestBody &&
		recursiveFind(
			components.components.schemas?.[method.inputType],
			createIs<{
				type: "string";
				format: "binary";
			}>(),
		)?.length
	) {
		requestBody.content["multipart/form-data"] = requestBody.content["application/json"];
		// biome-ignore lint/performance/noDelete: not allowing
		delete requestBody.content["application/json"];
	}

	paths[method.endpoint] ??= {
		servers: method.endpoint.startsWith("/pictrs") ? [{ url: "https://lemy.lol" }] : undefined,
	};
	// biome-ignore lint/style/noNonNullAssertion: we defined it one line above
	paths[method.endpoint]![method.method.toLowerCase() as "put" | "get" | "post"] = {
		operationId: method.name,
		description: method.description,
		parameters: parameters.length ? parameters : undefined,
		requestBody,
		tags: tag ? [tag] : undefined,
		responses: {
			200: method.outputType
				? {
						description: "Successful response",
						content: {
							"application/json": {
								schema: isPrimitiveType(method.outputType)
									? { type: method.outputType }
									: {
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
		version: process.env.LEMMY_VERSION || "0.0.0",
	},
	servers: [
		{
			url: `https://lemy.lol/api/${API_VERSION}`,
		},
	],
	security: [{ bearerAuth: [] }],
	externalDocs: {
		description: "Official Lemmy documentation",
		url: "https://join-lemmy.org/api/index.html",
	},
	tags: Array.from(usedTags).map((tag) => ({ name: tag })),
	paths,
	components: {
		schemas: {
			...components.components.schemas,
			// overwriting this because it's not correct for OpenAPI
			UploadImage: {
				type: "object",
				properties: {
					"images[]": {
						type: "array",
						items: {
							type: "string",
							format: "binary",
						},
						nullable: false,
					},
				},
				nullable: false,
			},
		},
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

await Bun.write(`${import.meta.dir}/../dist/openapi.json`, JSON.stringify(schema, null, 2));
await Bun.write(`${import.meta.dir}/../dist/openapi.yaml`, YAMLStringify(schema));
console.info("OpenAPI schema generated and saved to dist/openapi.json and dist/openapi.yaml");
