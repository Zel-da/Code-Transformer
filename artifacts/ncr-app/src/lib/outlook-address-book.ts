export interface AddressBookContact {
  displayName: string;
  email: string;
  username: string;
  department: string;
  title: string;
  position: string;
}

export interface AddressBookExcludedContact extends AddressBookContact {
  reason: "IT혁신팀" | "촉탁" | "공용/테스트 계정" | "이메일 없음";
}

export interface AddressBookPreview {
  contacts: AddressBookContact[];
  excluded: AddressBookExcludedContact[];
}

const NON_PERSON_NAMES = new Set([
  "아워홈",
  "RPA Robot",
  "Zoom 인증 계정01",
  "Zoom 인증 계정02",
  "jhtest",
  "부품구매",
  "고객지원",
  "마케팅",
  "세보틱스",
  "수산스캔",
  "시스템관리자",
  "테스트01",
  "화성_영양사",
  "test1",
]);

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

export async function parseOutlookAddressBook(file: File): Promise<AddressBookPreview> {
  const buffer = await file.arrayBuffer();
  const text = new TextDecoder("euc-kr").decode(buffer);
  const rows = parseCsv(text);
  const headers = rows[0]?.map((header) => header.replace(/^\uFEFF/, "").trim()) ?? [];
  const required = ["이름", "부서", "전자 메일 주소"];
  if (!required.every((header) => headers.includes(header))) {
    throw new Error("Outlook 주소록 CSV 형식이 아닙니다");
  }

  const index = (header: string) => headers.indexOf(header);
  const byEmail = new Map<string, AddressBookContact>();
  const noEmail: AddressBookExcludedContact[] = [];

  for (const values of rows.slice(1)) {
    const displayName = (values[index("이름")] ?? "").trim();
    const email = (values[index("전자 메일 주소")] ?? "").trim().toLowerCase();
    const department = (values[index("부서")] ?? "").trim();
    const title = (values[index("직함")] ?? "").trim();
    const position = (values[index("직책")] ?? "").trim();
    const contact: AddressBookContact = {
      displayName,
      email,
      username: email.includes("@") ? email.split("@")[0] : email,
      department,
      title,
      position,
    };

    if (!email) {
      noEmail.push({ ...contact, reason: "이메일 없음" });
    } else if (!byEmail.has(email)) {
      byEmail.set(email, contact);
    }
  }

  const contacts: AddressBookContact[] = [];
  const excluded: AddressBookExcludedContact[] = [...noEmail];
  for (const contact of byEmail.values()) {
    let reason: AddressBookExcludedContact["reason"] | null = null;
    if (contact.department.includes("IT혁신팀")) reason = "IT혁신팀";
    else if (contact.title.includes("촉탁") || contact.position.includes("촉탁")) reason = "촉탁";
    else if (NON_PERSON_NAMES.has(contact.displayName)) reason = "공용/테스트 계정";

    if (reason) excluded.push({ ...contact, reason });
    else contacts.push(contact);
  }

  return { contacts, excluded };
}