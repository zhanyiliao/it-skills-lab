# ITmockTest

## Project Overview
**ITmockTest** is an internal mock examination system developed using **PHP**, **SQL**, and **HTML/CSS**, with database management via **phpMyAdmin**. The project was developed by a team of three as part of a school internal system initiative. 

The purpose of this system is to assist students in preparing for the **Information Technology Basic Competency Certification**, which is a graduation requirement at our institution. The school provides PDF and DOC format question banks covering five core subjects. This system allows students to efficiently identify knowledge gaps while simulating real exam conditions.

The web application is divided into **User** and **Administrator** modules. Users can simulate full exams, practice specific subjects, review their scores, access real-time leaderboards, and track performance in each subject. Administrators can manage both the question bank and user accounts.

---

## Frontend Architecture

1. **User Interface (UI)**  
   - Built with **HTML** and **CSS**. PHP files generate the page structure, and `des.css` defines consistent styling for a professional and user-friendly interface.

2. **Frontend Interactivity**  
   - Implemented with **JavaScript** using **jQuery** to enhance dynamic behavior:
     - **Real-time search/filtering**: Dynamically updates user lists based on input.  
     - **Confirmation dialogs**: Prevents accidental edits or deletions.  
     - **Dynamic content updates**: AJAX is used to update page sections without full reloads.

3. **Pages and Components**  
   - `index.php`: Entry point, redirects to `homepage.php`.  
   - `homepage.php`: Main navigation hub; login modal appears if users attempt to start an exam before signing in.  
   - `about.php`: Introduces system purpose, development background, and source of questions.  
   - `choose.php`: Allows selection of a full exam (5 subjects × 10 questions) or practice in a specific subject.  
   - `testing.php`: Displays questions and captures user responses.  
   - `checking.php`: Processes scores; redirects to the transcript or review pages depending on exam type.  
   - `review.php`: Displays detailed exam results, including user answers, correct answers, and explanations.  
   - `leaderboard.php`: Shows ranking among users.  
   - `statistical_charts.php`: Graphically presents subject-wise statistics, such as highest error rates.

---

## Backend Architecture

1. **Server-side Logic**
   - **PHP**: Handles user requests, executes application logic, and communicates with the database.  
   - `utility_functions.php`: Contains reusable functions for database connection and page components, e.g.:
     - `db_link()`: Establishes MySQL connection using `mysqli_connect()`.  
     - `top_menu()`: Generates the top navigation menu, displaying different options based on user role.

2. **Database Management**
   - **MySQL** via **phpMyAdmin**. Key tables include:
     - **Users**: ID, account, password, name, role, registration date, last login, previous test records.  
     - **Question Banks**: Separate tables for each subject (Information Literacy & Ethics, Internet Fundamentals, Network Security, Office, Computer Fundamentals) with fields: question ID, content, options A–D, correct answer, explanation, total attempts, correct answers.

3. **Functional Modules**
   - **User Management (`member_management/`)**:  
     - `list.php`: Displays user info; allows role changes.  
     - `setting.php`: Processes role updates and deletions.  
   - **Question Bank Management (`question_management/`)**:  
     - `setting.php`: Handles addition, modification, and deletion of questions.  
     - `show.php`: Displays question statistics (total questions, max question number, missing questions), allows editing or deletion.  
   - **Modal Components (`modal/`)**: Handles login, logout, registration, password changes, and avatar updates.

---

## Web Server

The system is hosted on **Apache HTTP Server** to serve web content and manage requests.

