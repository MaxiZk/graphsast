import java.io.IOException;
import java.sql.*;
import javax.servlet.http.*;

public class UsuarioServlet extends HttpServlet {
    private Connection conn;

    protected void doGet(HttpServletRequest request, HttpServletResponse response) throws IOException {
        String id = request.getParameter("id");
        try {
            Statement st = conn.createStatement();
            ResultSet rs = st.executeQuery("SELECT nombre FROM usuarios WHERE id = " + id);
            response.setContentType("application/json");
        } catch (SQLException e) {
            response.sendError(500);
        }
    }
}
