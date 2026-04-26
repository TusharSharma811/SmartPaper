/**
 * Seed Script — Inserts 20 engineering questions into MongoDB
 * and optionally pushes them to ChromaDB via the AI service.
 *
 * Usage:
 *   node seedQuestions.js               (MongoDB only)
 *   node seedQuestions.js --with-vector  (MongoDB + ChromaDB)
 *
 * Make sure MongoDB is running and .env is configured.
 */

import "dotenv/config";
import mongoose from "mongoose";
import axios from "axios";
import Question from "./src/models/Question.js";

// ── 20 Engineering Questions (5 per subject) ────────────────────

const SEED_QUESTIONS = [
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Data Structures (5)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    text: "Explain the difference between a stack and a queue with real-world examples. Also compare their time complexities for insertion and deletion operations.",
    subject: "Data Structures",
    marks: 10,
    difficulty: "medium",
    topic: "Stacks and Queues",
    bloom_level: "K2",
    co: 1,
  },
  {
    text: "Write an algorithm for inserting a node in a Binary Search Tree (BST). Trace the algorithm for inserting the keys 50, 30, 70, 20, 40, 60, 80 into an initially empty BST.",
    subject: "Data Structures",
    marks: 10,
    difficulty: "medium",
    topic: "Trees",
    bloom_level: "K3",
    co: 2,
  },
  {
    text: "Discuss the various collision resolution techniques in hashing. Compare separate chaining and open addressing with suitable examples.",
    subject: "Data Structures",
    marks: 10,
    difficulty: "hard",
    topic: "Hashing",
    bloom_level: "K4",
    co: 3,
  },
  {
    text: "Apply Dijkstra's shortest path algorithm on a given weighted graph to find the shortest path from source vertex A to all other vertices. Show each step clearly.",
    subject: "Data Structures",
    marks: 10,
    difficulty: "hard",
    topic: "Graphs",
    bloom_level: "K3",
    co: 4,
  },
  {
    text: "Define a linked list. Explain the differences between singly linked list, doubly linked list, and circular linked list with diagrams.",
    subject: "Data Structures",
    marks: 5,
    difficulty: "easy",
    topic: "Linked Lists",
    bloom_level: "K1",
    co: 1,
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Computer Organization & Architecture (5)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    text: "Explain the instruction cycle of a basic computer. Draw and describe the fetch-decode-execute cycle with a timing diagram.",
    subject: "Computer Organization and Architecture",
    marks: 10,
    difficulty: "medium",
    topic: "Instruction Cycle",
    bloom_level: "K2",
    co: 1,
  },
  {
    text: "Compare RISC and CISC architectures based on instruction set, addressing modes, pipeline stages, and performance. Provide examples of each.",
    subject: "Computer Organization and Architecture",
    marks: 10,
    difficulty: "medium",
    topic: "RISC vs CISC",
    bloom_level: "K4",
    co: 2,
  },
  {
    text: "Design a 4-bit ripple carry adder using full adders. Explain the carry propagation delay problem and how carry look-ahead adders solve it.",
    subject: "Computer Organization and Architecture",
    marks: 10,
    difficulty: "hard",
    topic: "Arithmetic Circuits",
    bloom_level: "K6",
    co: 3,
  },
  {
    text: "Explain the concept of pipelining in CPU design. Discuss data hazards, control hazards, and structural hazards with methods to resolve them.",
    subject: "Computer Organization and Architecture",
    marks: 10,
    difficulty: "hard",
    topic: "Pipelining",
    bloom_level: "K4",
    co: 4,
  },
  {
    text: "Describe the memory hierarchy in a computer system. Explain the role of cache memory and discuss the difference between direct mapping, associative mapping, and set-associative mapping.",
    subject: "Computer Organization and Architecture",
    marks: 5,
    difficulty: "medium",
    topic: "Memory Organization",
    bloom_level: "K2",
    co: 2,
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Engineering Mathematics (5)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    text: "Solve the system of linear equations using Gauss-Jordan elimination method:\n  2x + y - z = 8\n  -3x - y + 2z = -11\n  -2x + y + 2z = -3",
    subject: "Engineering Mathematics",
    marks: 10,
    difficulty: "medium",
    topic: "Linear Algebra",
    bloom_level: "K3",
    co: 1,
  },
  {
    text: "Find the eigenvalues and eigenvectors of the matrix A = [[2, 1], [1, 2]]. Verify the Cayley-Hamilton theorem for this matrix.",
    subject: "Engineering Mathematics",
    marks: 10,
    difficulty: "medium",
    topic: "Eigenvalues and Eigenvectors",
    bloom_level: "K3",
    co: 2,
  },
  {
    text: "Evaluate the Laplace Transform of f(t) = t²·e^(3t)·sin(2t). State the properties used in your derivation.",
    subject: "Engineering Mathematics",
    marks: 10,
    difficulty: "hard",
    topic: "Laplace Transform",
    bloom_level: "K3",
    co: 3,
  },
  {
    text: "Solve the following first-order ordinary differential equation using the method of integrating factor: dy/dx + 2y = e^(-x), given y(0) = 1.",
    subject: "Engineering Mathematics",
    marks: 5,
    difficulty: "medium",
    topic: "Differential Equations",
    bloom_level: "K3",
    co: 4,
  },
  {
    text: "State and prove the Cauchy-Riemann equations. Use them to determine whether the function f(z) = z² + 2z is analytic.",
    subject: "Engineering Mathematics",
    marks: 10,
    difficulty: "hard",
    topic: "Complex Analysis",
    bloom_level: "K5",
    co: 5,
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Theory of Automata and Formal Languages (5)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    text: "Design a DFA that accepts all binary strings that end with '01'. Draw the transition diagram and transition table. Also verify with sample inputs '1101' and '1100'.",
    subject: "Theory of Automata and Formal Languages",
    marks: 10,
    difficulty: "medium",
    topic: "Deterministic Finite Automata",
    bloom_level: "K3",
    co: 1,
  },
  {
    text: "Convert the following NFA to an equivalent DFA using the subset construction method. The NFA has states {q0, q1, q2}, alphabet {0, 1}, start state q0, accept state q2, with transitions δ(q0,0)={q0,q1}, δ(q0,1)={q0}, δ(q1,1)={q2}.",
    subject: "Theory of Automata and Formal Languages",
    marks: 10,
    difficulty: "hard",
    topic: "NFA to DFA Conversion",
    bloom_level: "K3",
    co: 2,
  },
  {
    text: "State and prove the Pumping Lemma for regular languages. Use it to prove that the language L = {a^n b^n | n ≥ 0} is not regular.",
    subject: "Theory of Automata and Formal Languages",
    marks: 10,
    difficulty: "hard",
    topic: "Pumping Lemma",
    bloom_level: "K5",
    co: 3,
  },
  {
    text: "Construct a Context-Free Grammar (CFG) that generates the language L = {a^n b^m | n ≥ 1, m ≥ 1, n ≠ m}. Convert the grammar to Chomsky Normal Form (CNF).",
    subject: "Theory of Automata and Formal Languages",
    marks: 10,
    difficulty: "hard",
    topic: "Context-Free Grammars",
    bloom_level: "K6",
    co: 4,
  },
  {
    text: "Define a Turing Machine formally. Design a Turing Machine that accepts the language L = {ww^R | w ∈ {a, b}*} where w^R is the reverse of w. Show the transition function.",
    subject: "Theory of Automata and Formal Languages",
    marks: 10,
    difficulty: "hard",
    topic: "Turing Machines",
    bloom_level: "K6",
    co: 5,
  },
];

// ── Main ─────────────────────────────────────────────────────────

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://localhost:8000";

async function seedMongoDB() {
  console.log("\n🔌 Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGO_URI);
  console.log("✅ MongoDB connected\n");

  // Check existing count
  const existingCount = await Question.countDocuments();
  console.log(`📊 Existing questions in MongoDB: ${existingCount}`);

  // Insert seed questions
  console.log(`📥 Inserting ${SEED_QUESTIONS.length} seed questions...`);
  const inserted = await Question.insertMany(SEED_QUESTIONS);
  console.log(`✅ Successfully inserted ${inserted.length} questions into MongoDB\n`);

  // Summary per subject
  const subjects = [...new Set(SEED_QUESTIONS.map((q) => q.subject))];
  for (const subj of subjects) {
    const count = SEED_QUESTIONS.filter((q) => q.subject === subj).length;
    console.log(`   📚 ${subj}: ${count} questions`);
  }
  console.log();
}

async function pushToVectorStore() {
  console.log("🧠 Pushing questions to ChromaDB vector store (via AI service)...");
  try {
    const response = await axios.post(
      `${AI_SERVICE_URL}/add-questions`,
      {
        questions: SEED_QUESTIONS.map((q) => ({
          text: q.text,
          subject: q.subject,
          marks: q.marks,
          difficulty: q.difficulty,
          topic: q.topic,
        })),
      },
      {
        timeout: 60000,
        headers: { "Content-Type": "application/json" },
      }
    );
    console.log(`✅ ChromaDB: ${response.data.message}`);
    console.log(`   Added ${response.data.added} questions to the vector store\n`);
  } catch (err) {
    const msg = err.response?.data?.detail || err.message;
    console.warn(`⚠️  Could not push to ChromaDB (AI service may not be running): ${msg}`);
    console.warn("   Questions are still saved in MongoDB. You can sync to ChromaDB later.\n");
  }
}

async function main() {
  const withVector = process.argv.includes("--with-vector");

  try {
    // Step 1: Insert into MongoDB
    await seedMongoDB();

    // Step 2: Optionally push to ChromaDB
    if (withVector) {
      await pushToVectorStore();
    } else {
      console.log("ℹ️  Skipping ChromaDB sync. Run with --with-vector to also push to the vector store.\n");
    }

    // Final count
    const totalInDB = await Question.countDocuments();
    console.log(`📊 Total questions now in MongoDB: ${totalInDB}`);
    console.log("🎉 Seed complete!\n");
  } catch (err) {
    console.error("❌ Seed failed:", err.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 MongoDB disconnected");
  }
}

main();
