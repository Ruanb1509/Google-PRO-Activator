-- Activation instructions sent after the delivery of "Key Gemini Pro Student 12M".
-- Data-only; matches nothing (no-op) if the product does not exist. Editable later in the admin panel.
UPDATE "products"
SET "delivery_note" = $note$Como ativar seu plano

1. Conecte-se a uma VPN dos Estados Unidos.
   Com a VPN ativa, abra os sites https://GeminiPass.ai e https://gemini.google/students/

2. Insira sua chave de acesso no GeminiPass.
   No campo “Access Key”, cole o código recebido.
   Exemplo: VIP1-GD8A-SSQD-SD12.

3. Copie o link de verificação.
   No site do Gemini para estudantes, clique na opção para obter o plano. Quando abrir a página de verificação, copie a URL completa da barra de endereço. Ela deverá começar com https://services.sheerid.com/verify/.

4. Inicie a autenticação.
   Volte ao GeminiPass e cole o link no campo abaixo de “Access Key”. Clique em “Iniciar autenticação automática” e aguarde a conclusão do processo.

5. Finalize a ativação.
   Quando o processo terminar, clique no botão verde disponibilizado e siga as instruções para vincular um cartão e ativar o plano. Antes de confirmar, confira os valores, as condições da oferta e a data de renovação.$note$,
    "updated_at" = now()
WHERE "deleted_at" IS NULL
  AND "name" ILIKE '%Gemini Pro Student 12M%'
  AND ("delivery_note" IS NULL OR "delivery_note" = '');
