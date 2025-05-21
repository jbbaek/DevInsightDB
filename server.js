const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
const path = require("path");

const app = express();
const port = process.env.PORT || 5000;

// ✅ JSON 본문 처리 미들웨어
app.use(express.json());

// ✅ 정적 파일 제공 (public 폴더)
app.use(
  express.static("public", {
    setHeaders: (res, filePath) => {
      const basename = path.basename(filePath);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(basename)}`
      );
    },
  })
);

// ✅ CORS 설정
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:5000",
      "http://localhost:5001",
    ],
    credentials: true,
  })
);

// ✅ MySQL 연결 설정
const dbConfig = {
  host: "localhost",
  user: "manager",
  password: "1234",
  database: "devinsight",
};

let pool;
(async () => {
  try {
    pool = mysql.createPool(dbConfig);
    console.log("✅ MySQL 연결 성공");
  } catch (err) {
    console.error("❌ DB 연결 실패:", err.message);
    process.exit(1);
  }
})();

app.get("/user/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await pool.query("SELECT * FROM 회원 WHERE 회원id = ?", [
      id,
    ]);
    if (rows.length === 0)
      return res.status(404).json({ message: "사용자 없음" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: "DB 오류", error: err.message });
  }
});

// ✅ 기술도감 목록 API
app.get("/technologies", async (req, res) => {
  try {
    const [results] = await pool.query(`
      SELECT 기술도감id AS id, 
             COALESCE(언어, '') AS language, 
             COALESCE(프레임워크, '') AS framework, 
             COALESCE(라이브러리, '') AS library,
             COALESCE(라이브러리url, '') AS library_url,
             CASE 
               WHEN 언어 IS NOT NULL THEN '언어'
               WHEN 프레임워크 IS NOT NULL THEN '프레임워크'
               WHEN 라이브러리 IS NOT NULL THEN '라이브러리'
               ELSE '기타'
             END AS type
      FROM 기술도감
    `);
    console.log("기술도감 데이터 반환:", results.length, "개");
    return res.json(results);
  } catch (err) {
    console.error("기술도감 쿼리 오류:", err.message);
    return res.status(500).json({ message: "서버 오류", error: err.message });
  }
});

// ✅ 문항 목록 API
app.get("/questions/:techId", async (req, res) => {
  const { techId } = req.params;
  try {
    const [results] = await pool.query(
      `
      SELECT 문항id, \`문항 내용\` AS 문항내용, 기술도감id
      FROM 문항
      WHERE 기술도감id = ?
      ORDER BY 문항id
      `,
      [techId]
    );
    res.json(results);
  } catch (err) {
    console.error("❌ 문항 목록 쿼리 오류:", err.message);
    res
      .status(500)
      .json({ message: "문항을 불러오는 중 오류", error: err.message });
  }
});

// ✅ 문항 상세 정보 API
app.get("/question/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const [results] = await pool.query(
      `
      SELECT m.문항id, m.\`문항 내용\`, m.\`1번\`, m.\`2번\`, m.\`3번\`, m.\`4번\`, m.정답,
             m.문항유형id, m.기술도감id, m.직군id, m.분야id,
             t.문제유형, t.등급
      FROM 문항 m
      JOIN 문항유형 t ON m.문항유형id = t.문항유형id
      WHERE m.문항id = ?
      `,
      [id]
    );

    if (!results.length) return res.status(404).json({ message: "문항 없음" });

    const q = results[0];
    res.json({
      id: q.문항id,
      content: q["문항 내용"],
      options: [q["1번"], q["2번"], q["3번"], q["4번"]],
      answer: q.정답,
      문항유형id: q.문항유형id,
      기술도감id: q.기술도감id,
      직군id: q.직군id,
      분야id: q.분야id,
    });
  } catch (err) {
    console.error("문항 상세 조회 오류:", err.message);
    res.status(500).json({ message: "오류", error: err.message });
  }
});

app.post("/submit-answer", async (req, res) => {
  const {
    문항id,
    문항유형id,
    기술도감id,
    직군id,
    분야id,
    회원id,
    회원기술도감id,
    정답여부,
  } = req.body;

  try {
    const id = `R${Date.now()}`; // 간단한 고유 ID 생성

    await pool.query(
      `INSERT INTO 문항정답기록 
        (문항정답기록id, 정답여부, 문항id, 문항유형id, 기술도감id, 직군id, 분야id, 회원id, 회원기술도감id) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        정답여부,
        문항id,
        문항유형id,
        기술도감id,
        직군id,
        분야id,
        회원id,
        회원기술도감id,
      ]
    );

    res.status(201).json({ message: "정답 기록 저장 완료", id });
  } catch (err) {
    console.error("정답 기록 저장 실패:", err.message);
    res.status(500).json({ message: "서버 오류", error: err.message });
  }
});

// ✅ 회원가입 API
app.post("/signup", async (req, res) => {
  const { 회원id, 이름, 비밀번호, 이메일, 역할, 이미지url } = req.body;

  if (!회원id || !이름 || !비밀번호 || !이메일 || !역할) {
    return res.status(400).json({ message: "필수 항목이 누락되었습니다." });
  }

  try {
    // 중복 아이디 확인
    const [exist] = await pool.query("SELECT * FROM 회원 WHERE 회원id = ?", [
      회원id,
    ]);
    if (exist.length > 0) {
      return res.status(409).json({ message: "이미 존재하는 회원 ID입니다." });
    }

    const 가입일시 = new Date();

    await pool.query(
      `INSERT INTO 회원 (회원id, 이름, 비밀번호, 이메일, 역할, 가입일시, 이미지url)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [회원id, 이름, 비밀번호, 이메일, 역할, 가입일시, 이미지url || null]
    );

    console.log("✅ 회원 가입 성공:", 회원id);
    res.status(201).json({ message: "회원가입 성공" });
  } catch (err) {
    console.error("❌ 회원가입 에러:", err.message);
    res.status(500).json({ message: "서버 오류", error: err.message });
  }
});

// ✅ 로그인 API
app.post("/login", async (req, res) => {
  const { 회원id, 비밀번호 } = req.body;
  console.log("🛠️ 받은 데이터:", req.body);

  if (!회원id || !비밀번호) {
    return res
      .status(400)
      .json({ message: "아이디와 비밀번호를 모두 입력하세요." });
  }

  try {
    const [rows] = await pool.query("SELECT * FROM 회원 WHERE 회원id = ?", [
      회원id,
    ]);

    if (rows.length === 0) {
      return res.status(401).json({ message: "존재하지 않는 회원입니다." });
    }

    const user = rows[0];

    if (user.비밀번호 !== 비밀번호) {
      return res.status(401).json({ message: "비밀번호가 일치하지 않습니다." });
    }

    // 성공
    res.status(200).json({
      message: "로그인 성공",
      user: {
        회원id: user.회원id,
        이름: user.이름,
        역할: user.역할,
        이메일: user.이메일,
        이미지url: user.이미지url,
      },
    });
  } catch (err) {
    console.error("로그인 오류:", err.message);
    res.status(500).json({ message: "서버 오류", error: err.message });
  }
});

app.get("/main-job-postings", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        채용공고id AS id,
        제목 AS title,
        기업명 AS company,
        위치 AS location,
        기술스택 AS skills,
        마감일 AS deadline
      FROM 채용공고
      ORDER BY 채용공고id DESC
      LIMIT 4
    `);
    res.json(rows);
  } catch (err) {
    console.error("채용공고 불러오기 오류:", err.message);
    res.status(500).json({ message: "서버 오류" });
  }
});

app.get("/all-job-postings", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 채용공고id, 기업명, 제목, 마감일, 경력, 학력, 기술스택
      FROM 채용공고
      ORDER BY 채용공고id DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error("❌ 전체 채용공고 불러오기 오류:", err.message);
    res.status(500).json({ message: "서버 오류", error: err.message });
  }
});

app.get("/jobPosting/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const [rows] = await pool.query(
      `
      SELECT 
        c.\`채용공고id\`,
        c.\`기업id\`,
        c.\`제목\`,
        c.\`기업명\`,
        c.\`태그\`,
        c.\`기술스택\`,
        c.\`마감일\`,
        c.\`기업 소개\`,
        c.\`경력\`,
        c.\`학력\`,
        c.\`주요업무\`,
        c.\`자격요건\`,
        c.\`우대사항\`,
        c.\`복지 및 혜택\`,
        c.\`채용절차\`,
        c.\`위치\`,
        e.\`로고url\`,
        e.\`대표자명\`,
        e.\`홈페이지\`,
        e.\`설립 연도\`,
        e.\`고용보험가입 사원 수\`
      FROM 채용공고 c
      JOIN 기업 e ON c.\`기업id\` = e.\`기업id\`
      WHERE c.\`채용공고id\` = ?
      `,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "채용공고 없음" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("❌ 채용공고 상세 오류:", err.message);
    res.status(500).json({ message: "서버 오류", error: err.message });
  }
});

app.get("/company/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await pool.query("SELECT * FROM 기업 WHERE 기업id = ?", [
      id,
    ]);
    if (!rows.length) {
      return res.status(404).json({ message: "기업 정보를 찾을 수 없습니다." });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error("❌ 기업 정보 조회 오류:", err.message);
    res.status(500).json({ message: "서버 오류", error: err.message });
  }
});

// ✅ 서버 시작
app
  .listen(port, () => {
    console.log(`🚀 서버 실행 중: http://localhost:${port}`);
  })
  .on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `포트 ${port}가 이미 사용 중입니다. 다른 포트를 시도하거나 기존 프로세스를 종료하세요.`
      );
    } else {
      console.error("서버 시작 오류:", err.message);
    }
  });
