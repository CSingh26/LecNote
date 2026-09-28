import { useEffect, useState } from "react";
import { ArrowRight, FolderOpen } from "lucide-react";
import type { Course } from "../types";
import { CourseMaterialsPanel } from "../components/CourseMaterialsPanel";
import { Empty, PageHeader } from "../components/ui";

export function MaterialsPage({
  courses,
  initialCourse = "",
  onCourseChange,
}: {
  courses: Course[];
  initialCourse?: string;
  onCourseChange?: (courseId: string) => void;
}) {
  const [courseId, setCourseId] = useState(initialCourse);
  useEffect(() => setCourseId(initialCourse), [initialCourse]);
  const course = courses.find((item) => item.id === courseId);
  const choose = (value: string) => {
    setCourseId(value);
    onCourseChange?.(value);
  };
  return (
    <div className="materials-page">
      <PageHeader
        title={course ? `${course.name} materials` : "Materials"}
        actions={
          <label className="inline-field">
            <span>Course</span>
            <select
              aria-label="Course"
              value={course ? course.id : ""}
              onChange={(event) => choose(event.target.value)}
            >
              <option value="">All courses</option>
              {courses.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code ? `${item.code} · ` : ""}
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        }
      />
      {course ? (
        <CourseMaterialsPanel course={course} layout="page" />
      ) : courses.length ? (
        <ul className="course-destinations" aria-label="Courses with materials">
          {courses.map((item) => (
            <li key={item.id}>
              <a
                href={`#/materials?course=${encodeURIComponent(item.id)}`}
                onClick={(event) => {
                  if (!onCourseChange) return;
                  event.preventDefault();
                  choose(item.id);
                }}
              >
                <i style={{ backgroundColor: item.color }} aria-hidden="true" />
                <span>
                  {item.code && <strong>{item.code}</strong>}
                  <span>{item.name}</span>
                </span>
                <ArrowRight size={16} aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <Empty
          icon={FolderOpen}
          title="No courses yet"
          action={
            <a className="button primary" href="#/courses">
              Create a course
            </a>
          }
        >
          Course materials belong to a course. Create one to add files and
          notes.
        </Empty>
      )}
    </div>
  );
}
