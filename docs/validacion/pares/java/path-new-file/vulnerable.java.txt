import java.io.*;
import javax.servlet.http.*;

public class DescargaServlet extends HttpServlet {
    protected void doGet(HttpServletRequest request, HttpServletResponse response) throws IOException {
        String nombre = request.getParameter("archivo");
        File archivo = new File("/srv/reportes/" + nombre);
        try (InputStream in = new FileInputStream(archivo)) {
            in.transferTo(response.getOutputStream());
        }
    }
}
