import { buildBookAuthorPayload, parseAuthorNames } from "../src/services/authorService";

describe("parseAuthorNames", () => {
  it("separa nomes compostos por vírgula e conectores", () => {
    expect(parseAuthorNames("Machado de Assis e Clarice Lispector")).toEqual([
      "Machado de Assis",
      "Clarice Lispector",
    ]);
    expect(parseAuthorNames("J. R. R. Tolkien & George Orwell")).toEqual([
      "J. R. R. Tolkien",
      "George Orwell",
    ]);
  });
});

describe("buildBookAuthorPayload", () => {
  it("usa os autores vinculados quando disponíveis e preserva o texto legado como fallback", () => {
    expect(
      buildBookAuthorPayload({
        autor: "Autor legado",
        autores: [
          { id: 1, nome: "Clarice Lispector" },
          { id: 2, nome: "Machado de Assis" },
        ],
      })
    ).toEqual({
      autor: "Clarice Lispector, Machado de Assis",
      autores: [
        { id: 1, nome: "Clarice Lispector" },
        { id: 2, nome: "Machado de Assis" },
      ],
    });

    expect(buildBookAuthorPayload({ autor: "Autor legado", autores: [] })).toEqual({
      autor: "Autor legado",
      autores: [],
    });
  });
});
