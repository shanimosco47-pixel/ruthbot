# Save this as: test_conversations.py
# RUTH V2 Test Conversations — Pre-written scenarios

TEST_1_STANDARD = [
    ("User", "היא כעסה שלא עזרתי במטבח"),
    ("User", "נשאבתי למחשב, לא שמתי לב"),
    ("User", "אני רוצה שהיא תבין"),
    ("User", "כן, זה בדיוק")
]

TEST_2_FRUSTRATION = [
    ("User", "היא כעסה שלא עזרתי"),
    ("User", "נמאס לי מזה, זה לא עוזר"),  # <- Frustration
    ("User", "1"),  # User picks option 1
]

TEST_3_COMPLEX = [
    ("User", "היא אומרת שאני לא משקיע בילדות"),
    ("User", "תמיד בעבודה"),
    ("User", "בוא נקבע כלל לעתיד"),
]

# Intake template for validation
EXPECTED_FIRST_MESSAGE = """שלום! אני רות, מנחה זוגי.
בואו נתחיל בתלוש (משפט אחד לכל שאלה):
1️⃣ מה קרה?
2️⃣ מה אתה רוצה שיקרה בסוף?
3️⃣ מה אסור שיקרה?"""
