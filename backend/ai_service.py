from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline


TRAINING_DATA = [
    ("refund payment billing invoice charged twice", "Billing"),
    ("payment failed transaction refund request", "Billing"),
    ("subscription invoice incorrect amount", "Billing"),
    ("credit card charged twice for my order", "Billing"),
    ("need a refund for my payment", "Billing"),
    ("cannot login password reset account locked", "Account Access"),
    ("forgot password unable to access account", "Account Access"),
    ("account verification email login problem", "Account Access"),
    ("my account is locked and I cannot sign in", "Account Access"),
    ("reset my password to access my account", "Account Access"),
    ("application crashes error bug not working", "Technical Support"),
    ("website loading slowly server error", "Technical Support"),
    ("software installation technical issue", "Technical Support"),
    ("app keeps crashing when I open it", "Technical Support"),
    ("I receive an error when using the website", "Technical Support"),
    ("where is my order delivery shipment tracking", "Delivery"),
    ("package delayed not received delivery", "Delivery"),
    ("wrong address shipping order status", "Delivery"),
    ("my parcel has not arrived yet", "Delivery"),
    ("track my shipment and delivery date", "Delivery"),
    ("product features pricing available plans", "Product Information"),
    ("how does this product work", "Product Information"),
    ("product specifications supported features", "Product Information"),
    ("what features are included in this plan", "Product Information"),
    ("tell me about the available products", "Product Information"),
    ("need help with my request", "Other"),
    ("general question customer service", "Other"),
    ("I have a question about your service", "Other"),
    ("please contact me about my enquiry", "Other"),
    ("I need more information", "Other"),
]


def build_model():
    texts, labels = zip(*TRAINING_DATA)

    model = Pipeline(
        [
            (
                "tfidf",
                TfidfVectorizer(
                    ngram_range=(1, 2),
                    stop_words="english",
                    sublinear_tf=True,
                ),
            ),
            (
                "classifier",
                LogisticRegression(
                    max_iter=1000,
                    random_state=42,
                ),
            ),
        ]
    )

    model.fit(texts, labels)
    return model


MODEL = build_model()


def recommend_priority(text: str) -> str:
    text = text.lower()

    high_keywords = [
        "urgent",
        "critical",
        "emergency",
        "security breach",
        "data loss",
        "system down",
        "fraud",
        "account hacked",
        "production down",
        "cannot access",
    ]

    medium_keywords = [
        "error",
        "failed",
        "delay",
        "incorrect",
        "problem",
        "issue",
        "not working",
        "unable",
        "missing",
        "crash",
    ]

    if any(keyword in text for keyword in high_keywords):
        return "High"

    if any(keyword in text for keyword in medium_keywords):
        return "Medium"

    return "Low"


def analyze_ticket(title: str, description: str) -> dict:
    title = title.strip()
    description = description.strip()

    if len(title) < 3:
        raise ValueError("Title must contain at least 3 characters.")

    if len(description) < 3:
        raise ValueError("Description must contain at least 3 characters.")

    text = f"{title}. {description}"

    probabilities = MODEL.predict_proba([text])[0]
    classes = MODEL.named_steps["classifier"].classes_

    best_index = probabilities.argmax()

    return {
        "category": str(classes[best_index]),
        "recommended_priority": recommend_priority(text),
        "confidence": round(float(probabilities[best_index]), 4),
        "model": "TF-IDF + Logistic Regression",
    }