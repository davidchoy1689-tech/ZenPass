/**
 * ZENPASS COACH INDEPENDENT CONTRACTOR & PLATFORM SERVICES AGREEMENT
 * Version: ca-v1-2026-10（2026-10-28 依 David 指示草擬）
 *
 * 法律目的：依香港普通法「僱員 vs 獨立合約人」多重測試（Control / Integration /
 * Economic Reality）確立教練業務自主性，避免平台被認定為僱主或活動主辦方。
 * ⚠️ 上線前應由律師審閱。
 */
const COACH_AGREEMENT_V1 = {
  version: "ca-v1-2026-10",
  effectiveDate: "2026-10-28",
  title: "ZenPass 教練獨立合約人及平台服務協議",
  summary:
    "本協議確立你（教練）為獨立合約人，並非 ZenPass 的僱員、代理或合夥人；你對課堂教學及現場安全負排他性責任，平台僅提供發布、預訂及存證等技術支援。",
  clauses: [
    {
      id: "relationship",
      title: "1. 法律地位與獨立合約人身分 (Independent Contractor Status)",
      content:
        "教練確認並同意其為獨立合約人（Independent Contractor），雙方不存在任何僱傭、合夥、合營或代理關係。教練無權以 ZenPass 之名義作出任何承諾、簽署合約或招致負債。教練不享有香港《僱傭條例》(Cap. 57) 下之任何僱員福利（包括但不限於強積金供款、有薪病假、產假或工傷補償）。",
    },
    {
      id: "autonomy_and_control",
      title: "2. 教學自主性與專業裁量權 (Professional Autonomy)",
      content:
        "教練對課堂之具體教學流程、指導方式、技術難度及安全評估擁有完全之專業自主權。ZenPass 僅提供課堂發布、技術預訂、學費代收及數位認證等技術中介支援，不對現場教學細節實施實質控制。",
    },
    {
      id: "duty_of_care",
      title: "3. 現場安全與注意義務 (On-site Safety & Duty of Care)",
      content:
        "教練作為現場運動指導之持牌／核證專業人士，對出席學員之人身安全負有直接且排他性的專業注意義務（Duty of Care）。教練承諾：(a) 課前嚴格核實學員穿著符合運動標準；(b) 執行不少於 10 分鐘之強制性熱身運動；(c) 評估現場場地設施是否存在安全隱患，並在確認安全後方可開始活動；(d) 遇突發傷病時，第一時間採取合理急救措施並於平台即時備案 (Incident Log)。",
    },
    {
      id: "indemnity",
      title: "4. 全面彌償保證 (Indemnification)",
      content:
        "若因教練之專業疏忽、失職、蓄意不當行為、違反牌照守則或違反本協議條款，引致學員、場地第三方或任何機構向 ZenPass 提出索賠、法律訴訟、罰款或費用支出（包括合理的律師費用），教練同意向 ZenPass 及其關聯方作出全額抗辯、彌償並使其免受損害。",
    },
    {
      id: "tax_and_compliance",
      title: "5. 稅務與法定責任 (Tax & Statutory Compliance)",
      content:
        "教練須自行負責申報及繳納因提供教學服務所得之全數香港利得稅或個人入息課稅，並自行妥善保管其教學資質及專業資格之持續有效性。",
    },
    {
      id: "venue_split",
      title: "6. 場地責任切分 (Venue Responsibility)",
      content:
        "活動所使用之實體場地及固定設施（包括但不限於地面材質、牆面結構、電力系統、消防設施、照明及空調）均由場地營運方負責維護及安全；因場地缺陷引致之損害屬場地營運方及其公眾責任保險 (PLI) 範圍。平台僅提供預訂及存證支援。",
    },
  ],
};

module.exports = { COACH_AGREEMENT_V1 };
